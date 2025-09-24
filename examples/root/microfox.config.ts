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
};
