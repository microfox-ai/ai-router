/**
 * Worker Jobs API - Main Route
 * 
 * This route is kept for backward compatibility but is not actively used.
 * Use the specific worker routes instead:
 * - POST /api/worker-jobs/screenshot
 * - POST /api/worker-jobs/pdf
 * - POST /api/worker-jobs/scraper
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  return NextResponse.json(
    {
      ok: false,
      error: 'Please use specific worker routes: /api/worker-jobs/screenshot, /api/worker-jobs/pdf, or /api/worker-jobs/scraper',
    },
    { status: 400 }
  );
}


