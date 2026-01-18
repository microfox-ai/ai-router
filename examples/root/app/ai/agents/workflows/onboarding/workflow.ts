// import { z } from 'zod';
// import { defineHook } from 'workflow';

// // Define input/output schemas
// const onboardingInputSchema = z.object({
//   email: z.string().email(),
//   name: z.string(),
// });
// const onboardingOutputSchema = z.object({ status: z.string(), userId: z.string().optional() });

// // Define verification payload schema for type safety
// const verificationPayloadSchema = z.object({
//   type: z.enum(['email_click', 'admin_override']),
//   verifiedAt: z.string().optional(),
// });

// // Define the hook using defineHook for type safety
// const verificationHookSchema = defineHook({
//   schema: verificationPayloadSchema,
// });

// // Define step functions using the official workflow package
// // Steps must have the "use step" directive and are called via step()
// async function createUser(email: string, name: string) {
//   "use step";
//   // Simulate user creation
//   await new Promise(resolve => setTimeout(resolve, 500));
//   const userId = `user_${Date.now()}`;
//   console.log(`[CREATE USER] Created user ${userId} for ${email}`);
//   return { userId, email };
// }

// async function sendVerificationEmail(userId: string, email: string, verificationUrl: string) {
//   "use step";
//   // Simulate email sending
//   console.log(`[EMAIL] Sending verification to ${email}: ${verificationUrl}`);
//   await new Promise(resolve => setTimeout(resolve, 300));
//   return { sent: true };
// }

// async function markVerified(userId: string, method: 'email' | 'admin') {
//   "use step";
//   console.log(`[VERIFY] User ${userId} verified via ${method}`);
//   await new Promise(resolve => setTimeout(resolve, 200));
//   return { verified: true };
// }

// async function sendWelcomeEmail(userId: string, email: string) {
//   "use step";
//   console.log(`[EMAIL] Sending welcome email to ${email}`);
//   await new Promise(resolve => setTimeout(resolve, 300));
//   return { sent: true };
// }


// // External runtime entrypoint: `"use workflow"` function for onboarding.
// // IMPORTANT: This function must be exported directly for the Workflow DevKit
// // to process it at build time. The "use workflow" directive must be the first
// // statement in the function body.
// export async function onboardingWorkflowFn(input: z.infer<typeof onboardingInputSchema>) {
//   "use workflow";

//   const { email, name } = input;

//   // Step 1: Create user - call step function directly (Workflow DevKit intercepts via "use step")
//   const user = await createUser(email, name);

//   // Step 2: Create hook for email verification HITL
//   // Using defineHook pattern - create hook instance with custom token
//   // Token pattern: onboarding-verification:${email}
//   // NOTE: This will cause conflicts if multiple workflows start with same input!
//   // For production, use a unique identifier (runId, timestamp, or UUID) in the token
//   const hook = verificationHookSchema.create({
//     token: `onboarding-verification:${email}`,
//   });
  
//   // Log the token so it can be retrieved
//   console.log(`[HITL] Hook token: ${hook.token}`);

//   // Step 3: Send verification email
//   // Note: The actual signal URL will be constructed by the frontend using the runId
//   // from the workflow status response. The hook token is deterministic for lookup.
//   const verificationMessage = `Please verify your email. Use the workflow status endpoint to get the runId and call the signal endpoint.`;
//   await sendVerificationEmail(user.userId, user.email, verificationMessage);

//   // Step 4: Wait for verification (HITL pause)
//   // Workflow pauses here until someone calls the signal endpoint with the payload
//   // No compute resources are consumed while waiting - the workflow status should be "paused"
//   const verification = await hook;
//   console.log(`[HITL] Received verification for user ${user.userId}:`, verification);

//   // Step 5: Mark as verified based on verification type
//   await markVerified(user.userId, verification.type === 'email_click' ? 'email' : 'admin');

//   // Step 6: Send welcome email - call step function directly
//   await sendWelcomeEmail(user.userId, user.email);

//   return {
//     status: 'completed',
//     userId: user.userId,
//   };
// }

// // Export schemas for use in registration file
// export { onboardingInputSchema, onboardingOutputSchema };

