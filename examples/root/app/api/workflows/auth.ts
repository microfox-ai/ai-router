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
  return undefined;
}
