import { NextRequest, NextResponse } from 'next/server';

/**
 * Worker execution endpoint.
 * 
 * POST /api/workflows/workers/:workerId - Execute a worker
 * GET /api/workflows/workers/:workerId/:jobId - Get worker job status
 * POST /api/workflows/workers/:workerId/webhook - Webhook callback for completion notifications
 * 
 * This endpoint allows workers to be called like workflows, enabling
 * them to be used in orchestration.
 * 
 * Workers are auto-discovered from app/ai directory (any .worker.ts files) or
 * can be imported and registered manually via registerWorker().
 */

// Worker auto-discovery is implemented in ../registry/workers
// - Create worker registry module: app/api/workflows/registry/workers.ts
// - Scan app/ai/**/*.worker.ts files at startup or lazily on first access
// - Use glob pattern: 'app/ai/**/*.worker.ts'
// - Extract worker ID from file: const worker = await import(filePath); worker.id
// - Cache workers in memory or persistent store
// - Support hot-reload in development
// - Export: scanWorkers(), getWorker(workerId), listWorkers()

// Legacy registry for backward compatibility (deprecated - use registry/workers instead)
const legacyWorkerRegistry = new Map<string, () => Promise<any>>();

// NOTE: Next.js route modules must not export arbitrary symbols.
// Keep legacy registry support internal-only.
function registerWorkerLoader(workerId: string, workerLoader: () => Promise<any>) {
  legacyWorkerRegistry.set(workerId, workerLoader);
}

/**
 * Get a worker by ID using the new registry system.
 */
async function getWorkerById(workerId: string): Promise<any | null> {
  // Check legacy registry first for backward compatibility
  const loader = legacyWorkerRegistry.get(workerId);
  if (loader) {
    return await loader();
  }
  
  // Use new registry system with auto-discovery (dynamic import to avoid TypeScript resolution issues)
  const workersModule = await import('../../registry/workers') as { getWorker: (workerId: string) => Promise<any | null> };
  return await workersModule.getWorker(workerId);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  let slug: string[] = [];
  try {
    const { slug: slugParam } = await params;
    slug = slugParam || [];
    const [workerId, action] = slug;

    // Handle webhook endpoint
    if (action === 'webhook') {
      return handleWebhook(req, workerId);
    }

    // Handle job store update endpoint (POST /api/workflows/workers/:workerId/update)
    if (action === 'update') {
      return handleJobUpdate(req, workerId);
    }

    // Create job record (POST /api/workflows/workers/:workerId/job) – used before polling when trigger-only
    if (action === 'job') {
      return handleCreateJob(req, workerId);
    }

    if (!workerId) {
      return NextResponse.json(
        { error: 'Worker ID is required' },
        { status: 400 }
      );
    }

    let body;
    try {
      body = await req.json();
    } catch (parseError: any) {
      console.error('[Worker] Failed to parse request body:', {
        workerId,
        error: parseError?.message || String(parseError),
      });
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { input, await: shouldAwait = false, jobId: providedJobId } = body;

    console.log('[Worker] Dispatching worker:', {
      workerId,
      shouldAwait,
      hasInput: !!input,
    });

    // Get the worker using registry system
    let worker;
    try {
      worker = await getWorkerById(workerId);
    } catch (getWorkerError: any) {
      console.error('[Worker] Error getting worker:', {
        workerId,
        error: getWorkerError?.message || String(getWorkerError),
      });
      return NextResponse.json(
        { error: `Failed to get worker: ${getWorkerError?.message || String(getWorkerError)}` },
        { status: 500 }
      );
    }

    if (!worker) {
      console.warn('[Worker] Worker not found:', {
        workerId,
      });
      return NextResponse.json(
        { error: `Worker "${workerId}" not found. Make sure it's exported from a .worker.ts file.` },
        { status: 404 }
      );
    }

    // Webhook optional. Job updates use MongoDB only; never pass jobStoreUrl.
    const webhookBase = process.env.WORKFLOW_WEBHOOK_BASE_URL;
    const webhookUrl =
      shouldAwait && typeof webhookBase === 'string' && webhookBase
        ? `${webhookBase.replace(/\/+$/, '')}/api/workflows/workers/${workerId}/webhook`
        : undefined;

    // Use a single jobId end-to-end (Next job store + SQS/Lambda job store).
    // If caller provides jobId, respect it; otherwise generate one.
    const jobId =
      (typeof providedJobId === 'string' && providedJobId.trim()
        ? providedJobId.trim()
        : `job-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`);

    // Store initial job record
    const { setJob } = await import('../../stores/jobStore');
    try {
      await setJob(jobId, {
        jobId,
        workerId,
        status: 'queued',
        input: input || {},
        metadata: { source: 'workflow-orchestration' },
      });
      console.log('[Worker] Initial job record created:', {
        jobId,
        workerId,
      });
    } catch (setJobError: any) {
      console.error('[Worker] Failed to create initial job record:', {
        jobId,
        workerId,
        error: setJobError?.message || String(setJobError),
      });
      // Continue even if job store fails - worker dispatch can still proceed
    }

    // Dispatch the worker. Job updates use MongoDB only; webhook only if configured.
    let dispatchResult;
    try {
      dispatchResult = await worker.dispatch(input || {}, {
        mode: 'auto',
        jobId,
        ...(webhookUrl ? { webhookUrl } : {}),
        metadata: { source: 'workflow-orchestration' },
      });
      console.log('[Worker] Worker dispatched successfully:', {
        jobId: dispatchResult.jobId,
        workerId,
        messageId: dispatchResult.messageId,
      });
    } catch (dispatchError: any) {
      console.error('[Worker] Failed to dispatch worker:', {
        workerId,
        error: dispatchError?.message || String(dispatchError),
        stack: process.env.NODE_ENV === 'development' ? dispatchError?.stack : undefined,
      });
      throw new Error(`Failed to dispatch worker: ${dispatchError?.message || String(dispatchError)}`);
    }

    const finalJobId = dispatchResult.jobId || jobId;

    if (shouldAwait) {
      // For await mode, return job info and let caller poll status
      // The webhook handler will update the job when complete
      // For Vercel workflow: Use polling with setTimeout/setInterval
      // Workers are fire-and-forget only
      return NextResponse.json(
        {
          jobId: finalJobId,
          status: 'queued',
          message: 'Worker job queued. Use GET /api/workflows/workers/:workerId/:jobId to check status, or wait for webhook.',
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        jobId: finalJobId,
        status: dispatchResult.status || 'queued',
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Worker] Error in POST handler:', {
      workerId: slug[0],
      error: error?.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
    return NextResponse.json(
      { 
        error: error?.message || String(error),
        stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  let slug: string[] = [];
  try {
    const { slug: slugParam } = await params;
    slug = slugParam || [];
    const [workerId, jobId] = slug;

    if (!workerId || !jobId) {
      return NextResponse.json(
        { error: 'Worker ID and job ID are required' },
        { status: 400 }
      );
    }

    console.log('[Worker] Getting job status:', {
      jobId,
      workerId,
    });

    // Get job status from job store
    const { getJob } = await import('../../stores/jobStore');
    let job;
    try {
      job = await getJob(jobId);
    } catch (getJobError: any) {
      console.error('[Worker] Error getting job from store:', {
        jobId,
        workerId,
        error: getJobError?.message || String(getJobError),
      });
      return NextResponse.json(
        { error: `Failed to get job: ${getJobError?.message || String(getJobError)}` },
        { status: 500 }
      );
    }
    
    if (!job) {
      console.warn('[Worker] Job not found:', {
        jobId,
        workerId,
      });
      return NextResponse.json(
        { error: `Job "${jobId}" not found` },
        { status: 404 }
      );
    }
    
    console.log('[Worker] Job status retrieved:', {
      jobId,
      workerId,
      status: job.status,
    });
    
    return NextResponse.json(
      {
        jobId: job.jobId,
        workerId: job.workerId,
        status: job.status,
        output: job.output,
        error: job.error,
        metadata: job.metadata,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Worker] Error in GET handler:', {
      workerId: slug[0],
      jobId: slug[1],
      error: error?.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
    return NextResponse.json(
      { 
        error: error?.message || String(error),
        stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * Create job record before polling (trigger-only flow).
 * POST /api/workflows/workers/:workerId/job
 * Body: { jobId, input }
 */
async function handleCreateJob(req: NextRequest, workerId: string) {
  try {
    if (!workerId) {
      return NextResponse.json({ error: 'Worker ID is required' }, { status: 400 });
    }
    const body = await req.json();
    const { jobId, input } = body;
    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required in request body' }, { status: 400 });
    }
    const { setJob } = await import('../../stores/jobStore');
    await setJob(jobId, {
      jobId,
      workerId,
      status: 'queued',
      input: input ?? {},
      metadata: { source: 'workflow-orchestration' },
    });
    console.log('[Worker] Job created:', { jobId, workerId });
    return NextResponse.json({ message: 'Job created', jobId, workerId }, { status: 200 });
  } catch (error: any) {
    console.error('[Worker] Error creating job:', { workerId, error: error?.message || String(error) });
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}

/**
 * Handle job store update from worker context.
 * POST /api/workflows/workers/:workerId/update
 */
async function handleJobUpdate(req: NextRequest, workerId: string) {
  try {
    if (!workerId) {
      return NextResponse.json(
        { error: 'Worker ID is required' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { jobId, status, metadata, output, error } = body;

    if (!jobId) {
      return NextResponse.json(
        { error: 'jobId is required in request body' },
        { status: 400 }
      );
    }

    const { updateJob, setJob, getJob } = await import('../../stores/jobStore');
    const existing = await getJob(jobId);

    // Upsert: create job if missing (e.g. workflow triggered via /workers/trigger directly)
    if (!existing) {
      await setJob(jobId, {
        jobId,
        workerId,
        status: status ?? 'queued',
        input: {},
        metadata: metadata ?? {},
        output,
        error,
      });
      return NextResponse.json(
        { message: 'Job created and updated successfully', jobId, workerId },
        { status: 200 }
      );
    }

    const updateData: any = {};
    if (status !== undefined) updateData.status = status;
    if (metadata !== undefined) updateData.metadata = { ...existing.metadata, ...metadata };
    if (output !== undefined) updateData.output = output;
    if (error !== undefined) updateData.error = error;

    await updateJob(jobId, updateData);
    
    console.log('[Worker] Job updated:', { jobId, workerId, updates: Object.keys(updateData) });
    
    return NextResponse.json(
      { message: 'Job updated successfully', jobId, workerId },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Worker] Error updating job:', {
      workerId,
      error: error?.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}

/**
 * Handle webhook callback for worker completion.
 * POST /api/workflows/workers/:workerId/webhook
 * 
 * This endpoint receives completion notifications from workers.
 * It updates the job store with the final status before returning.
 * Webhook is only called if webhookUrl was provided during dispatch.
 */
async function handleWebhook(req: NextRequest, workerId: string) {
  try {
    if (!workerId) {
      return NextResponse.json(
        { error: 'Worker ID is required' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { jobId, status, output, error, metadata } = body;

    if (!jobId) {
      return NextResponse.json(
        { error: 'jobId is required in webhook payload' },
        { status: 400 }
      );
    }

    // Update job store with completion status (before any further processing)
    const { updateJob } = await import('../../stores/jobStore');
    
    const jobStatus = status === 'success' ? 'completed' : 'failed';
    
    try {
      // Update job with completion status
      await updateJob(jobId, {
        jobId,
        workerId,
        status: jobStatus,
        output,
        error,
        completedAt: new Date().toISOString(),
        metadata: metadata || {},
      });
      
      console.log('[Worker] Webhook received and job updated:', {
        jobId,
        workerId,
        status: jobStatus,
      });
    } catch (updateError: any) {
      console.error('[Worker] Failed to update job store from webhook:', {
        jobId,
        workerId,
        error: updateError?.message || String(updateError),
        stack: process.env.NODE_ENV === 'development' ? updateError?.stack : undefined,
      });
      // Continue even if job store update fails - webhook was received
    }
    
    return NextResponse.json(
      { message: 'Webhook received', jobId, workerId, status: jobStatus },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Worker] Error handling webhook:', {
      workerId,
      error: error?.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
