export const StudioConfig = {
  appName: 'Ai Router Kickstarter',
  appDescription:
    'A starter project for building AI Router applications with Next.js, Ai SDK, and Ai Router. Illustrates how you can do leaner orchestration & nested agents.',
  projectInfo: {
    framework: 'next-js',
  },
  studioSettings: {
    protection: {
      enabled: false,
      credentials: {
        email: process.env.MICROFOX_PROTECTION_EMAIL,
        password: process.env.MICROFOX_PROTECTION_PASSWORD,
      },
    },
    database: {
      type: 'local', // local | upstash-redis | supabase
      fileUpload: {
        enabled: true,
        apiKey: process.env.SERVER_SECRET_API_KEY,
      },
    },
  },
  // Workflow + worker runtime configuration (job store, etc.)
  workflowSettings: {
    jobStore: {
      // 'mongodb' | 'upstash-redis'
      type:
        (process.env.WORKER_DATABASE_TYPE as
          | 'mongodb'
          | 'upstash-redis') || 'upstash-redis',
      mongodb: {
        uri: process.env.DATABASE_MONGODB_URI || process.env.MONGODB_URI,
        db:
          process.env.DATABASE_MONGODB_DB ||
          process.env.MONGODB_DB ||
          'ai_router',
        workerJobsCollection:
          process.env.MONGODB_WORKER_JOBS_COLLECTION || 'worker_jobs',
        workflowStatusCollection:
          process.env.MONGODB_WORKFLOW_STATUS_COLLECTION || 'workflow_status',
      },
      redis: {
        url:
          process.env.WORKER_UPSTASH_REDIS_REST_URL ||
          process.env.UPSTASH_REDIS_REST_URL,
        token:
          process.env.WORKER_UPSTASH_REDIS_REST_TOKEN ||
          process.env.UPSTASH_REDIS_REST_TOKEN,
        keyPrefix:
          process.env.WORKER_UPSTASH_REDIS_JOBS_PREFIX ||
          'worker:jobs:',
        ttlSeconds:
          Number(process.env.WORKER_JOBS_TTL_SECONDS ?? 60 * 60 * 24 * 7),
      },
    },
  },
};
