import prompts from 'prompts';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { z } from 'zod';

export const configSchema = z.object({
  components: z.string(),
  ai: z.string(),
  utils: z.string(),
  importAlias: z.string(),
  useStudio: z.boolean(),
  chatSessionDb: z.enum(['local', 'supabase', 'upstash-redis']).optional(),
});

export type Config = z.infer<typeof configSchema>;

const DEFAULT_COMPONENTS_PATH = 'components';
const DEFAULT_AI_PATH = 'app/ai';
const DEFAULT_UTILS_PATH = 'lib/utils';
const DEFAULT_IMPORT_ALIAS = '@/';

export async function promptForConfig(): Promise<Config> {
  const responses: {
    useStudio?: boolean;
    chatSessionDb?: 'local' | 'supabase' | 'upstash-redis';
  } = await prompts([
    {
      type: 'toggle',
      name: 'useStudio',
      message: 'Do you need Ai Studio (Recommended)?',
      initial: true,
      active: 'Yes',
      inactive: 'No',
    },
  ]);

  if (responses.useStudio === undefined) {
    // User aborted prompt
    console.log(chalk.yellow('Configuration aborted. Exiting.'));
    process.exit(0);
  }

  if (responses.useStudio) {
    const dbResponse = await prompts({
      type: 'select',
      name: 'chatSessionDb',
      message: 'What Db to support for Chat Sessions?',
      choices: [
        { title: 'Local Storage (Recommended)', value: 'local' },
        // { title: 'Supabase', value: 'supabase' },
        { title: 'Upstash Redis', value: 'upstash-redis' },
      ],
      initial: 0,
    });
    responses.chatSessionDb = dbResponse.chatSessionDb;
  }

  const fullConfig = {
    components: DEFAULT_COMPONENTS_PATH,
    ai: DEFAULT_AI_PATH,
    utils: DEFAULT_UTILS_PATH,
    importAlias: DEFAULT_IMPORT_ALIAS,
    ...responses,
  };

  return configSchema.parse(fullConfig);
}

function getAppName(): string {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.name || 'My AI App';
  } catch (error) {
    return 'My AI App';
  }
}

export function writeConfigFile(config: Config) {
  const configFilePath = path.join(process.cwd(), 'microfox.config.ts');

  let dbConfig = '';
  if (config.useStudio) {
    if (config.chatSessionDb === 'local') {
      dbConfig = `database: {
      type: 'local', // local | upstash-redis | supabase
      fileUpload: {
        enabled: true,
        apiKey: process.env.SERVER_SECRET_API_KEY,
      },
    },`;
    } else if (config.chatSessionDb === 'supabase') {
      dbConfig = `database: {
      type: 'supabase', // local | upstash-redis | supabase
      credentials: {
        url: process.env.SUPABASE_URL,
        key: process.env.SUPABASE_ANON_KEY,
      },
      fileUpload: {
        enabled: true,
        apiKey: process.env.SERVER_SECRET_API_KEY,
      },
    },`;
    } else if (config.chatSessionDb === 'upstash-redis') {
      dbConfig = `database: {
      type: 'upstash-redis', // local | upstash-redis | supabase
      credentials: {
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      },
      fileUpload: {
        enabled: true,
        apiKey: process.env.SERVER_SECRET_API_KEY,
      },
    },`;
    }
  }

  const appName = getAppName();

  const content = `export const StudioConfig = {
  appName: '${appName}',
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
    ${dbConfig}
  },
};
`;

  fs.writeFileSync(configFilePath, content);
  console.log(
    chalk.green(`✓ Configuration file written to \`microfox.config.ts\`.`)
  );
}
