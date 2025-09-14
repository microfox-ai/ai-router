import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import * as tar from 'tar';
import { Project } from 'ts-morph';
import { Readable } from 'stream';
import { Config } from './config';
import { installDependencies } from './dependencies';
import { downloadTemplate } from './download';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface ComponentsJson {
  components?: string[];
}

async function transformImports(targetDir: string, config: Config) {
  const project = new Project();
  project.addSourceFilesAtPaths(`${targetDir}/**/*.ts`);
  project.addSourceFilesAtPaths(`${targetDir}/**/*.tsx`);

  const sourceFiles = project.getSourceFiles();

  for (const sourceFile of sourceFiles) {
    const importDeclarations = sourceFile.getImportDeclarations();
    for (const importDeclaration of importDeclarations) {
      const moduleSpecifier = importDeclaration.getModuleSpecifierValue();
      if (moduleSpecifier.startsWith('~/')) {
        const newSpecifier = moduleSpecifier.replace('~/', config.importAlias);
        importDeclaration.setModuleSpecifier(newSpecifier);
      }
    }
  }

  await project.save();
}

async function addGitignoreEntries(targetDir: string) {
  const gitignorePath = path.join(targetDir, '.gitignore');
  const entriesToAdd = ['\n# AI Studio', '.chat', '.studio'];

  try {
    let gitignoreContent = '';
    if (await fs.pathExists(gitignorePath)) {
      gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
    }

    const entries = entriesToAdd.filter(
      (entry) => !gitignoreContent.includes(entry)
    );

    if (entries.length > 0) {
      await fs.appendFile(gitignorePath, entries.join('\n'));
    }
  } catch (error) {
    // Silently fail but log it.
    console.error(chalk.yellow('Could not update .gitignore'), error);
  }
}

export async function scaffoldProject(templateName: string, config: Config) {
  const spinner = ora('Scaffolding project files...').start();
  const tmpDir = path.join(process.cwd(), '.tmp');

  try {
    // 1. Download and extract template
    spinner.text = 'Downloading template...';
    await fs.ensureDir(tmpDir);
    await downloadTemplate(templateName, tmpDir);
    await tar.x({
      file: path.join(tmpDir, 'template.tar.gz'),
      cwd: tmpDir,
    });

    const templateDir = tmpDir;

    // 2. Install dependencies
    const packageJsonPath = path.join(templateDir, 'package.json');
    const componentsJsonPath = path.join(templateDir, 'components.json');

    let shadcnComponents: string[] = [];

    if (!(await fs.pathExists(packageJsonPath))) {
      spinner.warn(
        chalk.yellow(
          'No `package.json` found in the template. Skipping dependency installation.'
        )
      );
    }

    await installDependencies(templateDir);

    // 3. Copy files to target directories
    spinner.text = 'Copying files...';

    const directoriesToCopy = [
      ['components', 'ai'],
      ['components', 'studio'],
      ['app', 'ai'],
      ['app', 'api', 'studio'],
      ['app', 'studio'],
      ['lib', 'studio'],
      ['app', 'page.tsx'],
    ];

    for (const dirParts of directoriesToCopy) {
      const sourcePath = path.join(templateDir, ...dirParts);
      const targetPath = path.join(process.cwd(), ...dirParts);
      if (await fs.pathExists(sourcePath)) {
        const stat = await fs.stat(sourcePath);
        if (stat.isDirectory()) {
          await fs.copy(sourcePath, targetPath);
        } else {
          // For files, ensure the target directory exists and copy the file
          await fs.ensureDir(path.dirname(targetPath));
          await fs.copyFile(sourcePath, targetPath);
        }
      }
    }

    // 4. Transform imports
    spinner.text = 'Transforming imports...';
    await transformImports(process.cwd(), config);

    // 5. Add .gitignore entries
    spinner.text = 'Updating .gitignore...';
    await addGitignoreEntries(process.cwd());

    spinner.succeed(chalk.green('Project scaffolding complete.'));
  } catch (error) {
    spinner.fail(chalk.red('Failed to scaffold project.'));
    console.error(error);
  } finally {
    await fs.remove(tmpDir);
  }
}
