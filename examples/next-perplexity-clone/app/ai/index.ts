import { AiRouter } from '@microfox/ai-router';
import { InferUITools } from 'ai';
import { braveResearchAgent } from './agents/braveResearch';
import { summarizeAgent } from './agents/summarize';
import { systemAgent } from './agents/system';
import { chatRestoreLocal } from './middlewares/chatSessionLocal';
import { contextLimiter } from './middlewares/contextLimiter';
import { mainOrchestrator } from './orchestrator';

const aiRouter = new AiRouter<any, any, any, any>();
aiRouter.setLogger(console);
// aiRouter.setStore(new MemoryStore());

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

export { aiRouterTools, type AiRouterTools };

//http://localhost:3000/api/studio/chat/agent/research/brave?query=Herohonda&deep=false&count=3
