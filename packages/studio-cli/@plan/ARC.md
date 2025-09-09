# ARC (Agent Registry Components) Plan

## 1. Philosophy and Goal

**ARC** is the component manager for `microfox-ai`. It is designed for the iterative, ongoing development phase that follows the initial project setup by `STUDIO`.

The primary goal of `ARC` is to allow developers to easily discover, install, and update individual, self-contained "agents" and their corresponding UI components from a curated registry. This promotes a modular architecture and allows the `microfox-ai` ecosystem to grow.

The core command for this functionality will be `arc add`.

## 2. The `arc add` Command Workflow

### Step 1: Configuration and Registry

- **[ ] Read `microfox.config.ts`**: The command will first locate and read the project's `microfox.config.ts` to determine where to install files. If the file doesn't exist, it will prompt the user to run `studio init` first.
- **[ ] Fetch `agents.json` Registry**: The CLI will download an `agents.json` file from a stable CDN URL (e.g., `https://cdn.microfox.ai/agents.json`). This file is the source of truth for all available agents.

Example `agents.json` structure:

```json
{
  "version": "1.0.0",
  "agents": {
    "brave-research": {
      "name": "Brave Research Agent",
      "version": "1.1.0",
      "description": "An agent that uses the Brave Search API to conduct research.",
      "dependencies": ["@brave/search"],
      "files": [
        {
          "path": "app/ai/agents/braveResearch/index.ts",
          "type": "agent",
          "url": "https://cdn.microfox.ai/agents/brave-research/1.1.0/index.ts"
        },
        {
          "path": "components/ai/braveResearch/card.tsx",
          "type": "component",
          "url": "https://cdn.microfox.ai/agents/brave-research/1.1.0/card.tsx"
        }
      ]
    }
  }
}
```

### Step 2: Agent Installation

- **[ ] User Selection**: The CLI can be run as `arc add <agent-name>` or interactively, where it lists all available agents for the user to choose from.
- **[ ] Fetch Agent Files**: Based on the selection, the CLI fetches the file URLs from the `agents.json` registry.
- **[ ] Transform and Write Files**:
  - Download the content for each file.
  - Perform `ts-morph` transformations on `.ts` and `.tsx` files to align import paths with the user's `microfox.config.ts`.
  - Write the transformed files to the correct locations in the user's project.
- **[ ] Install Dependencies**: Check the agent's `dependencies` against the user's `package.json`. Install any missing dependencies.
- **[ ] Provide Feedback**: Log a success message, including instructions on how to integrate and use the new agent.

## 3. ARC Component Structure

An "ARC component" is a logical grouping of files that make up a single agent. This typically includes:

- **Agent Logic**: The core TypeScript/JavaScript file(s) defining the agent's behavior, tools, and state.
  - Location: `app/ai/agents/[agent-name]/...`
- **UI Components**: The React components required to render the agent's output or provide user interaction.
  - Location: `components/ai/[agent-name]/...`

This co-location of agent logic and its UI within the registry definition makes the system easy to manage.

## 4. Future Considerations

- **[ ] `arc upgrade`**: A command to check the registry for newer versions of installed agents and allow for safe, automated updates.
- **[ ] `arc remove`**: A command to safely remove an agent and its associated files.
- **[ ] Custom Registries**: Allow users to point the CLI to their own `agents.json` file, enabling private agent sharing within organizations.
