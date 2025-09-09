export const StudioConfig = {
  appName: 'Root Template',
  projectInfo: {
    framework: 'next-js',
    librariesInUse: ['ai-router'],
  },
  studioSettings: {
    protection: {
      enabled: true,
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
    },
  },
};
