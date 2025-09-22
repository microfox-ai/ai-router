export const StudioConfig = {
  appName: 'Perplexity Clone',
  appDescription:
    'A clone of Perplexity built with AI Router & Ai SDk - Uses Brave, Google Search & Gemini a the LLM Model, All of which can be further configured.',
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
      type: 'local', // local | upstash-redis,
      credentials: {
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      },
      fileUpload: {
        enabled: true,
        apiKey: process.env.SERVER_SECRET_API_KEY,
      },
    },
  },
};
