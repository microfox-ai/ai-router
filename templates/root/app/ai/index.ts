import { AiRouter, MemoryStore } from '@microfox/ai-router';
import { chatRestoreUpstash } from './middlewares/chatSessionUpstash';
import { braveResearchAgent } from './agents/braveResearch';
import { mainOrchestrator } from './orchestrator';
import { InferUITools } from 'ai';
import { contextLimiter } from './middlewares/contextLimiter';
import { systemAgent } from './agents/system';
import { summarizeAgent } from './agents/summarize';
import { chatRestoreLocal } from './middlewares/chatSessionLocal';

const aiRouter = new AiRouter<any, any, any, any>();
aiRouter.setStore(new MemoryStore());

const aiMainRouter = aiRouter
  // .use('/', chatRestoreUpstash)
  .use('/', chatRestoreLocal)
  .use('/', contextLimiter(5))
  .agent('/', mainOrchestrator)
  .agent('/system', systemAgent)
  .agent('/summarize', summarizeAgent)
  .agent('/research/brave', braveResearchAgent);

// console.log('--------REGISTRY--------');
// console.log(aiMainRouter.registry());
const aiRouterRegistry = aiMainRouter.registry();
const aiRouterTools = aiRouterRegistry.tools;
type AiRouterTools = InferUITools<typeof aiRouterTools>;
// console.log('--------REGISTRY--------');

export { aiMainRouter, aiRouterRegistry };

export { type AiRouterTools, aiRouterTools };

//http://localhost:3000/api/studio/chat/agent/research/brave?query=Herohonda&deep=false&count=3
