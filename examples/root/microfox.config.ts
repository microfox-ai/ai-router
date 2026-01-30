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
      // Set type directly here or via DATABASE_TYPE env var (config takes precedence)
      type: (process.env.DATABASE_TYPE as 'local' | 'mongodb' | 'redis' | 'supabase') || 'mongodb', // local | mongodb | redis | supabase
      // MongoDB configuration (set values directly here, or they'll fallback to env vars)
      mongodb: {
        uri: process.env.DATABASE_MONGODB_URI || process.env.MONGODB_URI, // Set directly: 'mongodb://localhost:27017'
        db: process.env.DATABASE_MONGODB_DB || process.env.MONGODB_DB || 'ai_router', // Set directly: 'ai_router'
        // Override in config (e.g. 'my_status') or use env. Defaults: workflow_status, worker_jobs.
        workflowStatusCollection:
          process.env.MONGODB_WORKFLOW_STATUS_COLLECTION || 'workflow_status',
        workerJobsCollection:
          process.env.MONGODB_WORKER_JOBS_COLLECTION || 'worker_jobs',
      },
      // Redis configuration (set values directly here, or they'll fallback to env vars)
      redis: {
        url: process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_URL, // Set directly: 'https://your-redis.upstash.io'
        token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_TOKEN, // Set directly: 'your_token'
        keyPrefix: process.env.UPSTASH_REDIS_KEY_PREFIX || 'workflow:jobs:', // Set directly: 'workflow:jobs:'
      },
      fileUpload: {
        enabled: true,
        apiKey: process.env.SERVER_SECRET_API_KEY,
      },
    },
  },
};
