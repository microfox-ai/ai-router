import * as crypto from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * Returns the ID of the currently authenticated user for the given request.
 *
 * Replace this stub with your actual auth logic, for example:
 *   - Parse a JWT from the Authorization header
 *   - Read a session cookie (e.g. NextAuth, Clerk, Supabase)
 *   - Call your auth provider's SDK
 *
 * Returning `undefined` means no userId is attached to the worker job.
 *
 * @example with NextAuth
 * ```ts
 * import { getServerSession } from 'next-auth';
 * import { authOptions } from '@/app/api/auth/[...nextauth]/route';
 * export async function getClientId(req: NextRequest): Promise<string | undefined> {
 *   const session = await getServerSession(authOptions);
 *   return session?.user?.id;
 * }
 * ```
 */
export async function getClientId(_req: NextRequest): Promise<string | undefined> {
  // TODO: implement your auth logic here
  return "test-static-user";
}

/** Constant-time string comparison (avoids leaking the secret via timing). */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export type WorkflowAuthResult =
  | { ok: true; userId?: string; via: 'user' | 'internal' | 'public' }
  | { ok: false; status: number; error: string };

/**
 * Authorizes a **mutating** workflow request (trigger / update / webhook / approve / job).
 *
 * SECURITY: these routes mutate job + queue state and, for HITL approval,
 * dispatch the next pipeline step with reviewer-supplied input. They MUST NOT be
 * open to anonymous callers in production. A request is authorized when ANY of:
 *
 *   1. `getClientId(req)` resolves a user  → a real end-user session. **You must
 *      implement getClientId above for this to ever succeed.**
 *   2. It carries the internal shared secret (`x-workflow-secret` header equal to
 *      `WORKFLOW_INTERNAL_SECRET`, or `WORKERS_API_KEY` as a fallback so a single shared
 *      secret can cover both surfaces) → trusted Lambda→app callbacks (webhook/update).
 *      The deployed worker runtime sends this header when the env var is set.
 *   3. `WORKFLOW_ALLOW_PUBLIC === 'true'` → explicit opt-out for local demos. Logs a
 *      warning. **Never set this in production.**
 *
 * Otherwise the request is rejected with 401.
 */
export async function authorizeWorkflowRequest(
  req: NextRequest
): Promise<WorkflowAuthResult> {
  const userId = await getClientId(req);
  if (userId) return { ok: true, userId, via: 'user' };

  // Use a dedicated WORKFLOW_INTERNAL_SECRET if set, otherwise reuse WORKERS_API_KEY so a
  // single shared secret can gate both the deployed endpoints and these callback routes.
  const secret = process.env.WORKFLOW_INTERNAL_SECRET || process.env.WORKERS_API_KEY;
  if (secret && secret.trim()) {
    const provided =
      req.headers.get('x-workflow-secret') ||
      req.headers.get('X-Workflow-Secret') ||
      '';
    if (timingSafeEqualStr(provided, secret.trim())) {
      return { ok: true, via: 'internal' };
    }
  }

  if (process.env.WORKFLOW_ALLOW_PUBLIC === 'true') {
    console.warn(
      '[workflow-auth] Request allowed without authentication (WORKFLOW_ALLOW_PUBLIC=true). ' +
        'Do not use this in production — implement getClientId() and/or set WORKFLOW_INTERNAL_SECRET.'
    );
    return { ok: true, via: 'public' };
  }

  return {
    ok: false,
    status: 401,
    error:
      'Unauthorized. Implement getClientId() in app/api/workflows/auth.ts, send the ' +
      'x-workflow-secret header (WORKFLOW_INTERNAL_SECRET or WORKERS_API_KEY) for internal ' +
      'callbacks, or set WORKFLOW_ALLOW_PUBLIC=true for local development.',
  };
}
