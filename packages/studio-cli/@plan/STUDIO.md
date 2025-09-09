# STUDIO Architecture Plan

## 1. Overview

**STUDIO** is the scaffolding engine for `microfox-ai`. Its primary responsibility is to perform the initial, one-time setup of a user's Next.js project with a pre-defined "Studio" template. This process is designed to be robust, configurable, and user-friendly.

The core command for this functionality is `studio init`.

## 2. `studio init` Command Workflow

The `init` command will execute a series of steps to configure the user's project.

### Step 1: Environment Validation

The CLI must first validate that it is running in a compatible environment.

- **[ ] Check for Next.js Project**: Verify the existence of `next.config.js` or `next.config.mjs` in the project root.
- **[ ] Check for App Router**: Parse `next.config.js` to ensure it doesn't have `pages/` directory enabled in a way that conflicts, and check for the presence of an `app/` directory.
- **[ ] Check Next.js Version**: Ensure the Next.js version in `package.json` meets the minimum requirement (e.g., `>13.4`).
- **[ ] Error Handling**: If any validation fails, the command should exit gracefully with a clear and actionable error message.

### Step 2: Interactive Configuration (`microfox.config.ts`)

If validation passes, the CLI will gather configuration details from the user via interactive prompts.

- **[ ] Prompt for Component Path**: Ask the user for the installation path for UI components (e.g., `components/`).
- **[ ] Prompt for AI Logic Path**: Ask for the path for core AI logic (e.g., `app/ai/`).
- **[ ] Prompt for Util/Lib Path**: Detect or ask for the import alias for utility functions (e.g., `@/lib/utils`).
- **[ ] Generate `microfox.config.ts`**: Create a `microfox.config.ts` file in the project root, populating it with the user's answers. This file will act as the source of truth for all subsequent operations.

Example `microfox.config.ts`:

```typescript
import { defineConfig } from '@microfox/cli';

export default defineConfig({
  components: '~/components',
  ai: '~/app/ai',
  utils: '~/lib/utils',
});
```

### Step 3: Template Selection (via `studio.json` Registry)

The CLI will fetch a registry of available templates to allow user selection.

- **[ ] Fetch Registry**: Download `studio.json` from a stable CDN URL (e.g., `https://cdn.microfox.ai/studio.json`).
- **[ ] Parse and Validate Registry**: Use `zod` to validate the structure of the fetched JSON.
- **[ ] Prompt for Template Selection**: Display the available templates from the registry and prompt the user to choose one.

Example `studio.json`:

```json
{
  "version": "0.1.0",
  "templates": {
    "perplexity-clone": {
      "name": "Perplexity Clone",
      "description": "The default starter kit with a full-featured UI.",
      "dependencies": ["@upstash/redis", "zod", "ai"],
      "devDependencies": ["@types/node"],
      "shadcn-components": ["button", "card", "dialog", "tabs"],
      "files": "https://cdn.microfox.ai/templates/perplexity-clone-v0.1.0.tar.gz"
    }
  }
}
```

### Step 4: Project Dependencies Setup

Based on the selected template's metadata, the CLI will configure the project's dependencies.

- **[ ] Install `npm` Dependencies**: Read the `dependencies` and `devDependencies` arrays from the template metadata. Add them to the user's `package.json` if they don't already exist.
- **[ ] Run `npm install`**: Run the appropriate package manager install command (`npm install`, `yarn`, or `pnpm detect`).
- **[ ] Initialize `shadcn/ui`**: Programmatically execute `npx shadcn-ui@latest init` with non-interactive flags, using the configuration from `microfox.config.ts`.
- **[ ] Add `shadcn/ui` Components**: Programmatically execute `npx shadcn-ui@latest add [components...]` for all components listed in the template's `shadcn-components` array.

### Step 5: File Scaffolding and Code Transformation

This is the core step where the template files are added and modified.

- **[ ] Download and Extract Template**: Fetch the compressed template files (`.tar.gz`) from the CDN URL.
- **[ ] Copy Files**: Copy the extracted files into the user's project, respecting the paths defined in `microfox.config.ts`.
- **[ ] Use `ts-morph` for Transformations**: After copying, parse all `.ts` and `.tsx` files with `ts-morph`.
  - **[ ] Update Import Paths**: Traverse the AST of each file and rewrite import statements to match the user's configured import aliases. This is far more robust than simple find-and-replace.
  - **[ ] Future: Conditional Code Blocks**: This setup allows for future enhancements, such as removing specific functions or components from the scaffolded code based on user configuration.

## 3. Recommended Libraries

- **`commander`**: CLI framework.
- **`chalk`**: Terminal styling.
- **`ora`**: Spinners for long-running tasks.
- **`prompts`**: Interactive user prompts.
- **`zod`**: Schema validation for `studio.json` and `microfox.config.ts`.
- **`node-fetch` / `axios`**: For HTTP requests to the CDN.
- **`tar`**: For decompressing template archives.
- **`ts-morph`**: For robust TypeScript code analysis and transformation.
- **`execa`**: For reliably executing shell commands like `npx shadcn-ui`.

- gitignore
- ts checks
- shadcdn perfection
- selected configured microfox.config.ts
