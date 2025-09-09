# Git Workflow and CDN Publishing Plan

## 1. Overview

This document outlines the CI/CD process for versioning, packaging, and publishing `STUDIO` templates and `ARC` agents to a CDN. Automating this process ensures consistency, reduces manual error, and decouples the assets from the CLI tool's release cycle.

We will use **GitHub Actions** as the CI/CD platform.

## 2. Triggering the Workflow

The publishing workflow will be triggered automatically on the creation of a new **Git tag** that follows semantic versioning, prefixed with either `templates-` or `agents-`.

- **Example for Templates**: `git tag templates-v0.1.0`
- **Example for Agents**: `git tag agents-v1.2.3`

Pushing the tag (`git push origin templates-v0.1.0`) will initiate the workflow.

## 3. Workflow Steps for `STUDIO` Templates

**Workflow file:** `.github/workflows/publish-templates.yml`
**Trigger:** `on: push: tags: 'templates-v*'`

1.  **[ ] Checkout Code**: The workflow starts by checking out the repository code.
2.  **[ ] Setup Node.js**: Sets up the required Node.js environment.
3.  **[ ] Parse Tag**: Extract the version number from the Git tag (e.g., `v0.1.0` -> `0.1.0`).
4.  **[ ] Package Templates**:
    - For each directory in `templates/studio/*`, create a compressed `.tar.gz` archive.
    - Name the archive with the template name and version (e.g., `perplexity-clone-0.1.0.tar.gz`).
5.  **[ ] Upload to CDN**:
    - Authenticate with the CDN provider (e.g., AWS S3, Vercel Blob, etc.) using secrets stored in GitHub.
    - Upload each packaged template to a versioned path (e.g., `https://cdn.microfox.ai/templates/perplexity-clone-0.1.0.tar.gz`).
6.  **[ ] Update `studio.json` Registry**:
    - Download the existing `studio.json` from the CDN.
    - Update the `version` field and the `files` URL for the corresponding template.
    - This step must be idempotent and safe for concurrent runs if needed.
7.  **[ ] Upload `studio.json`**: Upload the modified `studio.json` back to the CDN, overwriting the previous version.

## 4. Workflow Steps for `ARC` Agents

This workflow will be similar but will operate on individual agent files and the `agents.json` registry. It can be a separate workflow file.

**Workflow file:** `.github/workflows/publish-agents.yml`
**Trigger:** `on: push: tags: 'agents-v*'`

1.  **[ ] Checkout, Setup, Parse Tag**: Same as the templates workflow.
2.  **[ ] Package Agents**:
    - The workflow will need a manifest or convention to identify which agent files have changed or are part of the new release.
    - It will upload individual files rather than archives.
3.  **[ ] Upload to CDN**:
    - Upload each agent file to a versioned path (e.g., `https://cdn.microfox.ai/agents/brave-research/1.2.3/index.ts`).
4.  **[ ] Update `agents.json` Registry**:
    - Download the existing `agents.json`.
    - Update the version and file URLs for the specific agent(s) included in the release.
5.  **[ ] Upload `agents.json`**: Upload the modified `agents.json` back to the CDN.

## 5. Required Secrets

The following secrets will need to be configured in the GitHub repository settings:

- `CDN_ACCESS_KEY_ID`: Access key for the CDN/blob storage.
- `CDN_SECRET_ACCESS_KEY`: Secret key for the CDN/blob storage.
- `CDN_BUCKET_NAME`: The name of the bucket or container.
- `CDN_ENDPOINT`: The endpoint URL for the CDN.
