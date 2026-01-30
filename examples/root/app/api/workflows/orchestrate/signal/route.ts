import { NextRequest, NextResponse } from 'next/server';
import { resumeHook } from 'workflow/api';

/**
 * POST /api/workflows/orchestrate/signal - Send signal to resume hook
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, payload } = body;

    if (!token) {
      return NextResponse.json(
        { error: 'token is required in request body' },
        { status: 400 }
      );
    }

    if (payload === undefined || payload === null) {
      return NextResponse.json(
        { error: 'payload is required in request body' },
        { status: 400 }
      );
    }

    console.log('[Orchestrate] Resuming hook:', {
      token,
    });

    // Resume hook using Vercel workflow API
    let result: any;
    try {
      result = await resumeHook(token, payload);
    } catch (resumeError: any) {
      console.error('[Orchestrate] Error resuming hook:', {
        token,
        error: resumeError?.message || String(resumeError),
        stack: process.env.NODE_ENV === 'development' ? resumeError?.stack : undefined,
      });
      return NextResponse.json(
        { 
          error: `Failed to resume hook: ${resumeError?.message || String(resumeError)}`,
          stack: process.env.NODE_ENV === 'development' ? resumeError?.stack : undefined,
        },
        { status: 500 }
      );
    }

    console.log('[Orchestrate] Hook resumed successfully:', {
      token,
      status: result?.status,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Signal sent successfully',
        result,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[Orchestrate] Error handling signal:', {
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
