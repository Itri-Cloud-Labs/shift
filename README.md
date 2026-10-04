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

The server and disconnected Electron client foundations are implemented. Verify both workspaces and run an isolated headless server smoke demonstration:

```sh
pnpm check
node apps/server/tools/platform-smoke.mjs
```

Use `pnpm dev` to start the Linux server from source, or `pnpm build` followed by `node apps/server/dist/cli.js serve`. See [server setup and CLI administration](apps/server/README.md) for private state directories, configuration, health/readiness and shutdown.

Use `pnpm app:dev` on a desktop to open the disconnected Electron shell. `pnpm app:package` builds an unsigned unpacked app. See [app setup and smoke checks](apps/app/README.md) for Linux/Xvfb verification, code boundaries, and platform limitations. The app does not start a local server or harness.

Run `pnpm format` to format application source, tools, configuration and implementation docs. `pnpm check` includes `pnpm format:check`. Generated protocol artifacts are formatted by `pnpm protocol:generate`; applied migrations retain their recorded hashes.

Read the [server specification](docs/shift-server-v0.md) and [client specification](docs/shift-client-v0.md) before implementing features. Both remain proposed for approval.
