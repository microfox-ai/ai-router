# `ai-router build` and `dev` Commands

To improve performance, the `ai-router` CLI provides `build` and `dev` commands to pre-compute the router's registry of agents and tools.

## `ai-router build`

This command generates a static registry file for your AI router. This is ideal for production environments.

### Usage

```bash
npx ai-router build [options]
```

### Options

-   `-e, --entry <path>`: Path to the entry file exporting the `AiRouter` instance (default: `"app/ai/index.ts"`).
-   `-o, --output <path>`: Path to the output directory for the static registry file (default: `"app/ai"`).

## `ai-router dev`

This command starts a file watcher that automatically rebuilds the static registry whenever you make changes to your AI agents.

### Usage

```bash
npx ai-router dev [options]
```

### Options

-   `-e, --entry <path>`: Path to the entry file exporting the `AiRouter` instance (default: `"app/ai/index.ts"`).
-   `-o, --output <path>`: Path to the output directory for the static registry file (default: `"app/ai"`).
-   `-w, --watch <path>`: Directory to watch for changes (default: `"app/ai"`).