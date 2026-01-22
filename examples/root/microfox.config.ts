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
      type: (process.env.DATABASE_TYPE as 'local' | 'mongodb' | 'upstash-redis' | 'supabase') || 'local', // local | mongodb | upstash-redis | supabase
      // MongoDB configuration (set values directly here, or they'll fallback to env vars)
      mongodb: {
        uri: process.env.DATABASE_MONGODB_URI || process.env.MONGODB_URI, // Set directly: 'mongodb://localhost:27017'
        db: process.env.DATABASE_MONGODB_DB || process.env.MONGODB_DB || 'ai_router', // Set directly: 'ai_router'
        collection: process.env.DATABASE_MONGODB_COLLECTION || 'workflow_jobs', // Set directly: 'workflow_jobs'
      },
      // Upstash Redis configuration (set values directly here, or they'll fallback to env vars)
      upstashRedis: {
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
  workflow: {
    // Set provider directly here or via WORKFLOW_PROVIDER env var (config takes precedence)
    provider: (process.env.WORKFLOW_PROVIDER as 'vercel' | 'upstash') || 'vercel',
    adapters: {
      vercel: {
        // Vercel workflow-specific config (if needed)
      },
      upstash: {
        // Set values directly here, or they'll fallback to env vars
        token: process.env.QSTASH_TOKEN, // Set directly: 'your_qstash_token'
        url: process.env.QSTASH_URL, // Set directly: 'https://qstash.upstash.io/v2'
        currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY, // Set directly: 'your_key'
        nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY, // Set directly: 'your_key'
      },
    },
  },
};
