import path from 'path';
import fs from 'fs-extra';
import { Readable } from 'stream';

const BASE_URL =
  'https://github.com/microfox-ai/ai-router/raw/refs/heads/main/examples/';
export async function downloadTemplate(templateName: string, tmpDir: string) {
  const templateUrl = `${BASE_URL}/${templateName}.tar.gz`;
  const response = await fetch(templateUrl);
  if (!response.body) {
    throw new Error('Failed to download template: No response body.');
  }

  const fileStream = fs.createWriteStream(path.join(tmpDir, 'template.tar.gz'));
  await new Promise((resolve, reject) => {
    Readable.fromWeb(response.body as any)
      .pipe(fileStream)
      .on('finish', () => resolve(undefined))
      .on('error', reject);
  });
}
