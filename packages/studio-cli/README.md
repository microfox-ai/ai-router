# @microfox/studio-cli

A CLI for scaffolding and managing Microfox AI Studio projects.

## Usage

The primary command is `init`, which scaffolds a new Studio project in an existing Next.js application.

```bash
npx @microfox/studio-cli init
```

This command will guide you through the following steps:

1.  **Project Validation**: Ensures you are in a valid Next.js project with the App Router.
2.  **Configuration**: Prompts you for your preferences on installing Shadcn components, setting up basic AI agents, and using the AI Studio. It also asks for your preferred database for chat sessions if you opt for the studio.
3.  **Dependency Installation**: Installs all necessary npm dependencies and `shadcn/ui` components.
4.  **File Scaffolding**: Copies the template files into your project and intelligently transforms the import paths to match your configuration.

You can also specify a template to use with the `--template` flag:

```bash
npx @microfox/studio-cli init --template <template-name>
```

## Testing Locally

To test the CLI locally before publishing, you can use `npm link`.

1.  **Navigate to the CLI package**:

    ```bash
    cd packages/studio-cli
    ```

2.  **Build the package**:
    This will compile the TypeScript source code into JavaScript in the `dist` directory.

    ```bash
    npm run build
    ```

3.  **Link the package**:
    This creates a global symlink from the package name to the local directory.

    ```bash
    npm link
    ```

4.  **Navigate to a test project**:
    Go to a separate Next.js project that you want to use for testing.

    ```bash
    cd /path/to/your/nextjs-test-project
    ```

5.  **Run the CLI**:
    You can now run the CLI using the command defined in the `bin` field of `package.json`.
    ```bash
    studio-cli init
    ```

This will execute your local version of the CLI within the test project, allowing you to verify its functionality end-to-end.
