import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import tar from 'tar';
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

    const templateDir = path.join(tmpDir, 'template');

    // 2. Install dependencies
    const packageJsonPath = path.join(templateDir, 'package.json');
    const componentsJsonPath = path.join(templateDir, 'components.json');

    let dependencies: string[] = [];
    let devDependencies: string[] = [];
    let shadcnComponents: string[] = [];

    if (await fs.pathExists(packageJsonPath)) {
      const packageJson: PackageJson = await fs.readJson(packageJsonPath);
      dependencies = Object.keys(packageJson.dependencies || {});
      devDependencies = Object.keys(packageJson.devDependencies || {});
    } else {
      spinner.warn(
        chalk.yellow(
          'No `package.json` found in the template. Skipping dependency installation.'
        )
      );
    }

    if (await fs.pathExists(componentsJsonPath)) {
      const componentsJson: ComponentsJson =
        await fs.readJson(componentsJsonPath);
      shadcnComponents = componentsJson.components || [];
    }

    await installDependencies(dependencies, devDependencies, shadcnComponents);

    // 3. Copy files to target directories
    spinner.text = 'Copying files...';
    await fs.copy(
      path.join(templateDir, 'components', 'ai'),
      path.join(process.cwd(), 'components', 'ai')
    );
    await fs.copy(
      path.join(templateDir, 'components', 'studio'),
      path.join(process.cwd(), 'components', 'studio')
    );
    await fs.copy(
      path.join(templateDir, 'components', 'studio'),
      path.join(process.cwd(), 'components', 'studio')
    );
    await fs.copy(
      path.join(templateDir, 'app', 'ai'),
      path.join(process.cwd(), 'app', 'ai')
    );
    await fs.copy(
      path.join(templateDir, 'app', 'api', 'studio'),
      path.join(process.cwd(), 'app', 'api', 'studio')
    );
    await fs.copy(
      path.join(templateDir, 'app', 'studio'),
      path.join(process.cwd(), 'app', 'studio')
    );
    await fs.copy(
      path.join(templateDir, 'lib', 'studio'),
      path.join(process.cwd(), 'lib', 'studio')
    );

    // 4. Transform imports
    spinner.text = 'Transforming imports...';
    await transformImports(process.cwd(), config);

    // 5. Add .gitignore entries
    spinner.text = 'Updating .gitignore...';
    await addGitignoreEntries(process.cwd());

    spinner.succeed(chalk.green('✓ Project scaffolding complete.'));
  } catch (error) {
    spinner.fail(chalk.red('Failed to scaffold project.'));
    console.error(error);
  } finally {
    await fs.remove(tmpDir);
  }
}
