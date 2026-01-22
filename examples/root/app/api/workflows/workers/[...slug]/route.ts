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

/**
 * Register a worker for use in workflows.
 * This should be called from a worker file or a registry module.
 * 
 * @deprecated Use registerWorker from '../registry/workers' instead
 */
export function registerWorkerLoader(workerId: string, workerLoader: () => Promise<any>) {
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
  try {
    const { slug: slugParam } = await params;
    const slug = slugParam || [];
    const [workerId, action] = slug;

    // Handle webhook endpoint
    if (action === 'webhook') {
      return handleWebhook(req, workerId);
    }

    if (!workerId) {
      return NextResponse.json(
        { error: 'Worker ID is required' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { input, await: shouldAwait = false } = body;

    // Get the worker using registry system
    const worker = await getWorkerById(workerId);

    if (!worker) {
      return NextResponse.json(
        { error: `Worker "${workerId}" not found. Make sure it's exported from a .worker.ts file.` },
        { status: 404 }
      );
    }

    // Get base URL for webhook callback if awaiting
    const baseUrl = req.nextUrl.origin;
    const webhookUrl = shouldAwait 
      ? `${baseUrl}/api/workflows/workers/${workerId}/webhook`
      : undefined;

    // Generate a pseudo jobId for initial tracking (will be updated with actual jobId from dispatch)
    const pseudoJobId = `job-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Store initial job record
    const { setJob } = await import('../../stores/jobStore');
    await setJob(pseudoJobId, {
      jobId: pseudoJobId,
      workerId,
      status: 'queued',
      input: input || {},
      metadata: { source: 'workflow-orchestration' },
    });

    // Dispatch the worker
    const dispatchResult = await worker.dispatch(input || {}, {
      mode: 'auto',
      webhookUrl,
      metadata: { source: 'workflow-orchestration', pseudoJobId },
    });

    // Update job with actual jobId from dispatch result if different
    const finalJobId = dispatchResult.jobId || pseudoJobId;
    if (dispatchResult.jobId && dispatchResult.jobId !== pseudoJobId) {
      await setJob(dispatchResult.jobId, {
        jobId: dispatchResult.jobId,
        workerId,
        status: 'queued',
        input: input || {},
        metadata: { source: 'workflow-orchestration' },
      });
    }

    if (shouldAwait) {
      // For await mode, return job info and let caller poll status
      // The webhook handler will update the job when complete
      // For Vercel workflow: Use polling with setTimeout/setInterval
      // For Upstash workflow: Use context.waitForEvent with jobId as eventId
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
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  try {
    const { slug: slugParam } = await params;
    const slug = slugParam || [];
    const [workerId, jobId] = slug;

    if (!workerId || !jobId) {
      return NextResponse.json(
        { error: 'Worker ID and job ID are required' },
        { status: 400 }
      );
    }

    // Get job status from job store
    const { getJob } = await import('../../stores/jobStore');
    const job = await getJob(jobId);
    
    if (!job) {
      return NextResponse.json(
        { error: `Job "${jobId}" not found` },
        { status: 404 }
      );
    }
    
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
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}

/**
 * Handle webhook callback for worker completion.
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
    const { jobId, status, output, error } = body;

    if (!jobId) {
      return NextResponse.json(
        { error: 'jobId is required in webhook payload' },
        { status: 400 }
      );
    }

    // Store job result in job store
    const { updateJob } = await import('../../stores/jobStore');
    
    const jobStatus = status === 'success' ? 'completed' : 'failed';
    
    // Update job with completion status
    await updateJob(jobId, {
      jobId,
      workerId,
      status: jobStatus,
      output,
      error,
      completedAt: new Date().toISOString(),
      metadata: body.metadata || {},
    });
    
    return NextResponse.json(
      { message: 'Webhook received', jobId, workerId, status: jobStatus },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
