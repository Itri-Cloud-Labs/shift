# Shift App

The Electron client currently opens a disconnected workspace with Projects, Workflows, Runs, Sessions, Attention, and Settings. Development starts with deterministic sample records. Packaged builds start empty; Settings can show or hide the sample workspace. Every sample view is labeled. Search, project selection, and read-only detail dialogs work. Server mutations remain disabled.

The app never starts a Shift server, harness, or agent. Pairing, authenticated HTTP/SSE, credential persistence, workflow editing, and connected queries are later milestones. The foundation has injected transport and credential interfaces, with Node-only tests against fakes. There are no stored credentials in this version.

## Run and verify

Use the root's pinned Node 24 and pnpm 12.6.0. On a desktop with a display:

```sh
pnpm install --frozen-lockfile
pnpm app:dev
```

`app:dev` builds all three entries and opens Electron using bundled assets. It deliberately uses the same custom scheme and security settings as packaging. Restart the command after source changes. Root `pnpm dev` still starts the server; use `app:dev` for the desktop.

```sh
pnpm check
pnpm app:package
pnpm --filter @shift/app smoke:packaged
```

For Linux without a display, install Xvfb and Electron's GTK/NSS/audio/GBM desktop libraries, then use:

```sh
xvfb-run -a pnpm app:smoke
xvfb-run -a pnpm --filter @shift/app smoke:packaged
```

The smoke runs the actual built or packaged application. It checks all six screens, sample toggling, dialog focus, invalid requests, credential omission, disabled mutations, CSP, network denial, and window creation. It verifies the OS sandbox through Linux process status or Electron's macOS/Windows process metrics. Preload also refuses to expose its bridge unless sandboxing and context isolation are active. Temporary smoke profiles are removed after exit.

Electron cannot run as root with its sandbox enabled. The smoke tool handles a root Linux development container by copying only the app and Electron into an owned temporary directory and launching as `nobody` through `runuser`. The copied Chromium sandbox helper has its required root ownership and mode. Xauthority and profile files belong to that test user; the tool removes the directory afterwards. Normal desktop/CI users run directly. The application never passes `--no-sandbox`.

A separate developer-only browser preview is available after building:

```sh
pnpm --filter @shift/app preview:ui
```

This preview serves fixtures on port 4173 for UI inspection. Its fake bridge lives in `vite.preview.config.ts` and is absent from desktop output. It does not establish Electron security or live server behavior.

## Code boundaries

| Directory                | Responsibility                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main`               | Electron lifecycle, custom scheme, asset allowlist, permissions/navigation, validated IPC dispatch.                                                         |
| `src/preload`            | A single CommonJS bundle exposing four named methods through contextBridge.                                                                                 |
| `src/client-core`        | Platform-independent fixture state and validated foundation queries using injected transport and credentials. Disconnect invalidates outstanding responses. |
| `src/client-ui`          | React screens and view state. No Electron, Node, client-core implementation, or backend imports.                                                            |
| `src/shared`             | App-local IPC schemas, inferred types, safe errors, and explicit payload limits.                                                                            |
| `src/protocol/generated` | Byte-identical server-owned types, standalone validators, schemas, and foundation fixtures. Regenerate from the root.                                       |
| `tools`                  | Bundle inspection and built/packaged smoke launcher.                                                                                                        |
| `test`                   | Boundary and client-core regression tests running without Electron.                                                                                         |

The bridge exposes `readShell`, `setSamples`, `queryServer`, and `openDocumentation`. Status queries allow only `info`, `health`, and `ready`; the current composition has no active profile and returns `DISCONNECTED`. There is no arbitrary URL, command, channel, filesystem, or token interface. Opening documentation uses one fixed HTTPS destination in main. Main checks the owned webContents, top frame, and exact application document before dispatch. Requests are limited to 8 KiB, responses to 256 KiB, and JSON nesting to 16 levels. Unknown fields, invalid discriminants, coercions, cycles, and non-JSON values fail validation. Raw exception messages never cross the bridge.

Main serves only build-listed files below the renderer directory using `shift://app/index.html`. It rejects unknown assets, methods, userinfo, ports, queries, and paths outside the directory. All assets carry CSP and MIME headers. Context isolation, sandboxing, and web security are enabled; Node integration, webviews, permissions, downloads, renderer networking, navigation, and child windows are disabled. The renderer uses bundled fonts and scripts under `script-src 'self'` without eval or remote code.

`electron.vite.config.ts` checks the module graph before bundling. `tools/check-bundle.mjs` parses the emitted JavaScript with Acorn, checks preload imports and renderer code, rejects backend/native dependencies, and writes the asset allowlist. All JavaScript dependencies are bundled at build time, so the packaged ASAR contains `dist` and the app manifest, with no runtime node_modules. The bundled DM Sans font license is copied to `dist/licenses/dm-sans.txt`. Server protocol drift checking remains mandatory.

## Platform evidence

Local Linux x64 build, strict type checks, tests, and actual built/packaged Electron smoke are recorded in [implementation progress](../../docs/implementation-progress.md). The [client CI workflow](../../.github/workflows/app.yml) builds and smoke-tests an unsigned unpacked application on matching runners:

- Linux x64: `ubuntu-22.04`, with Xvfb.
- Windows x64: `windows-2022`.
- macOS x64: `macos-15-intel`.
- macOS arm64: `macos-15`.

Runner labels match GitHub's published catalog. Their availability to this repository and successful execution remain unverified until CI runs; missing runners are not skipped or treated as passing. This task did not trigger remote CI. Windows/macOS are untested locally. These unpacked packages are foundation smoke artifacts, not signed installers. Windows signing, macOS signing/notarization, Linux distribution artifacts, OS secret-service behavior, and minimum-OS validation remain release prerequisites in prompt 31.
