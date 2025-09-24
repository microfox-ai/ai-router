export const StudioConfig = {
  appName: 'next-job-assist',
  appDescription:
    'A job assisting agent that saves your experience, works in a rag kind of like notebook.lm, and on-demand when you request for it, creates job applications, emails, survey answers, and more...',
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
