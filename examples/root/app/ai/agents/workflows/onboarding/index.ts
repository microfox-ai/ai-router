import { createWorkflow, createStep, buildHitlToken } from '@microfox/ai-router';
import { z } from 'zod';
import { aiRouter } from '../shared';

// Define Steps - types are automatically inferred from Zod schemas!
const createUserInputSchema = z.object({ email: z.string().email(), name: z.string() });
const createUserOutputSchema = z.object({ userId: z.string(), email: z.string() });

const createUserStep = createStep({
  id: 'create-user',
  input: createUserInputSchema,
  output: createUserOutputSchema,
  run: async (input: z.infer<typeof createUserInputSchema>) => {
    // "use step" is automatically injected by createStep()
    // Simulate user creation
    await new Promise(resolve => setTimeout(resolve, 500));
    const userId = `user_${Date.now()}`;
    console.log(`[CREATE USER] Created user ${userId} for ${input.email}`);
    return { userId, email: input.email };
  },
});

const sendVerificationEmailInputSchema = z.object({ userId: z.string(), email: z.string(), verificationUrl: z.string() });
const sendVerificationEmailStep = createStep({
  id: 'send-verification-email',
  input: sendVerificationEmailInputSchema,
  output: z.object({ sent: z.boolean() }),
  run: async (input: z.infer<typeof sendVerificationEmailInputSchema>) => {
    // Simulate email sending
    console.log(`[EMAIL] Sending verification to ${input.email}: ${input.verificationUrl}`);
    await new Promise(resolve => setTimeout(resolve, 300));
    return { sent: true };
  },
});

const markVerifiedInputSchema = z.object({ userId: z.string(), method: z.enum(['email', 'admin']) });
const markVerifiedStep = createStep({
  id: 'mark-verified',
  input: markVerifiedInputSchema,
  output: z.object({ verified: z.boolean() }),
  run: async (input: z.infer<typeof markVerifiedInputSchema>) => {
    console.log(`[VERIFY] User ${input.userId} verified via ${input.method}`);
    await new Promise(resolve => setTimeout(resolve, 200));
    return { verified: true };
  },
});

const sendWelcomeEmailInputSchema = z.object({ userId: z.string(), email: z.string() });
const sendWelcomeEmailStep = createStep({
  id: 'send-welcome-email',
  input: sendWelcomeEmailInputSchema,
  output: z.object({ sent: z.boolean() }),
  run: async (input: z.infer<typeof sendWelcomeEmailInputSchema>) => {
    console.log(`[EMAIL] Sending welcome email to ${input.email}`);
    await new Promise(resolve => setTimeout(resolve, 300));
    return { sent: true };
  },
});

// Define Workflow - types inferred from Zod schemas
const onboardingInputSchema = z.object({
  email: z.string().email(),
  name: z.string(),
});
const onboardingOutputSchema = z.object({ status: z.string(), userId: z.string().optional() });

const onboardingWorkflow = createWorkflow({
  id: 'onboarding-workflow-v1',
  version: '1.0',
  input: onboardingInputSchema,
  output: onboardingOutputSchema,
  handler: async (ctx: any) => {
    // Types are inferred from schemas - ctx.input is properly typed
    const { email, name } = ctx.input as z.infer<typeof onboardingInputSchema>;

    // Step 1: Create user
    const user = await ctx.run(createUserStep, { email, name });

    // Step 2: Create deterministic token for HITL
    const token = buildHitlToken('onboarding-signal', user.userId);
    
    // Step 3: Send verification email with link
    const verificationUrl = `/api/workflow/verify?token=${token}`;
    await ctx.run(sendVerificationEmailStep, {
      userId: user.userId,
      email: user.email,
      verificationUrl,
    });

    // Step 4: Wait for verification (email click OR admin override)
    // Using createHook pattern with deterministic token
    const signalSchema = z.object({
      type: z.enum(['email_click', 'admin_override']),
    });
    const signal = await ctx.waitForEvent('verification', {
      timeout: '7d',
      schema: signalSchema,
      ui: {
        title: 'Email Verification Required',
        description: `Please verify your email address: ${email}`,
      },
    }) as z.infer<typeof signalSchema>;

    // Step 5: Mark as verified
    await ctx.run(markVerifiedStep, {
      userId: user.userId,
      method: signal.type === 'email_click' ? 'email' : 'admin',
    });

    // Step 6: Send welcome email
    await ctx.run(sendWelcomeEmailStep, {
      userId: user.userId,
      email: user.email,
    });

    return ctx.complete({
      status: 'completed',
      userId: user.userId,
    });
  },
});

// Mount workflow on router - storage is auto-configured from microfox.config.ts
aiRouter.useWorkflow(
  '/workflows/onboarding',
  onboardingWorkflow,
  {
    exposeAsTool: true,
  }
);

