/**
 * Puppeteer Worker Example - Main AI Router
 * 
 * This example demonstrates background worker agents using Puppeteer.
 * Workers are dispatched via API routes and run asynchronously on AWS Lambda.
 * 
 * See:
 * - app/ai/agents/puppeteer/*.worker.ts for worker implementations
 * - app/ai/agents/puppeteer/index.ts for agent wrappers
 * - app/api/studio/chat/agent/[...slug] for the agent API endpoint
 */

import { AiRouter } from '@microfox/ai-router';
import { InferUITools } from 'ai';
import { puppeteerAgent } from './agents/puppeteer';
import { contextLimiter } from './middlewares/contextLimiter';
import { onlyTextParts } from './middlewares/onlyTextParts';

const aiRouter = new AiRouter<any, any, any, any>();
// aiRouter.setLogger(console);

const aiMainRouter = aiRouter.agent('/puppeteer', puppeteerAgent)

// console.log('--------REGISTRY--------');
const aiRouterRegistry = aiMainRouter.registry();
const aiRouterTools = aiRouterRegistry.tools;
type AiRouterTools = InferUITools<typeof aiRouterTools>;
// console.log('--------REGISTRY--------');

export { aiMainRouter, aiRouterRegistry, aiRouterTools, type AiRouterTools };