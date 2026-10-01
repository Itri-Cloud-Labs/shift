# Shift

Shift is a self-hosted control plane for autonomous coding-agent workflows.
The server coordinates durable execution; the app displays state and issues commands.

## Repository layout

- [apps/server](apps/server/) is the headless Node.js server workspace.
- [apps/app](apps/app/) is the Electron client workspace.
- [docs](docs/) contains specifications and implementation plans.

These are the only two workspaces for now. Applications live under `apps/`, following [T3 Code's workspace layout](https://github.com/pingdotgg/t3code/blob/main/pnpm-workspace.yaml). Shared modules can be extracted into `packages/` when needed.

## Setup

Use Node.js 24 and the pnpm version pinned in `package.json`.

```sh
corepack enable
pnpm install
```

The workspaces currently contain package manifests only. Development and build commands will be added with the implementation.

Read the [server specification](docs/shift-server-v0.md) and [client specification](docs/shift-client-v0.md) before implementing features. Both remain proposed for approval.
