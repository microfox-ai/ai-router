import { AiRouter } from '@microfox/ai-router';
import { handleFfprobeAgent } from './server-wrappers/ffprobe';
import { handleVideoConverterAgent } from './server-wrappers/video-converter';

const aiRouter = new AiRouter<any, any, any, any, any>();

export const ffmpegAgents = aiRouter
  .agent('/ffprobe', async (ctx) => {
    try {
      ctx.response.writeMessageMetadata({
        loader: 'Analyzing media file...',
      });
      const result = await handleFfprobeAgent(ctx.request.params);
      ctx.response.write({
        type: 'data-text-jobId',
        data: result.jobId,
        id: ctx.response.generateId(),
      });
      ctx.response.write({
        type: 'text-delta',
        delta: `FFprobe analysis started. Job ID: ${result.jobId}`,
        id: ctx.response.generateId(),
      });
      return result;
    } catch (error: any) {
      console.error('ffprobe agent error', error);
      ctx.response.write({
        type: 'text-delta',
        delta: `Error: ${error.message || 'Unknown error'}`,
        id: ctx.response.generateId(),
      });
      return {
        ok: false,
        error: error.message || 'Unknown error',
      };
    }
  })
  .agent('/video-converter', async (ctx) => {
    try {
      ctx.response.writeMessageMetadata({
        loader: 'Converting video...',
      });
      const result = await handleVideoConverterAgent(ctx.request.params);
      ctx.response.write({
        type: 'data-text-jobId',
        data: result.jobId,
        id: ctx.response.generateId(),
      });
      ctx.response.write({
        type: 'text-delta',
        delta: `Video conversion started. Job ID: ${result.jobId}`,
        id: ctx.response.generateId(),
      });
      return result;
    } catch (error: any) {
      console.error('video-converter agent error', error);
      ctx.response.write({
        type: 'text-delta',
        delta: `Error: ${error.message || 'Unknown error'}`,
        id: ctx.response.generateId(),
      });
      return {
        ok: false,
        error: error.message || 'Unknown error',
      };
    }
  });

