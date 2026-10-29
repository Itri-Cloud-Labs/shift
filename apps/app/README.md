# Shift App

The Electron client follows the [desktop UI direction](../../docs/ui-direction.md): the workflow graph canvas is the whole app, and everything else floats over it as islands. Its visual system is in [DESIGN.md](../../DESIGN.md), and who it is for in [PRODUCT.md](../../PRODUCT.md).

The app never starts a Shift server, harness, or agent. The main process pairs with a server, keeps the device token in the OS keychain, reconnects, and keeps a synchronized cache of the server's state. The renderer shows that state. The canvas is view-only for now; editing, the inbox with human forms and approvals, settings and the command palette are later milestones.

## The canvas shell

- **Pairing** is the one full-screen step. It takes the server address, the eight-word phrase from `shift device pair` and a device name, and explains each connection problem in words.
- **Canvas:** a frameless window with a React Flow canvas edge to edge. A workflow's draft opens by default; a run shows the graph of the version it started on, fetched from `GET /workflows/{id}/versions/{versionId}`. Nodes are cards with their type, one line of configuration and named ports. In a run each shows its state in a word, an icon and a color, how many times it ran, and which port it took. Followed connections are solid; others are dashed. Graphs without saved positions, including the server's default row, are laid out left to right with dagre.
- **Islands:**
  - Top left: the location (Project › Workflow › Run ▾). It opens the switcher (projects and their workflows, searchable) and the runs menu, with the draft first. In a run, the run status island sits beside it: state, why it waits, active time, version and Cancel with a confirmation.
  - Top right: the connection chip and the number of things that need the owner.
  - Right edge: the inspector for the selected node, with its output per loop pass, attempts, connections and configuration.
  - Bottom: zoom, fit, the node and connection list (the keyboard and screen-reader view of the graph), the published version and Run. A trigger with an input schema asks for its input first.
  - When not live, a banner says why, offers Retry when offline, and the last copy of each view stays visible.
- **Routes** live in the URL fragment (`#/p/<project>/w/<workflow>/r/<run>/n/<node>`), so every island links to the same place.
- **Look:** Inter and JetBrains Mono, bundled locally. Dark and light themes follow the OS, with tinted neutrals and one signal-green accent; status colors only mean state. Motion is limited to island open/close and state changes, and stops with reduced motion.
- **Screenshots for design review:** `pnpm --filter @shift/app build && xvfb-run -a node tools/capture.mjs <dir>` starts a server from source with throwaway state, creates a demo workflow and a waiting run, pairs the built app in capture mode (unpackaged builds only) and saves PNGs of the main views in both themes.

## Connections

`client-core/connection.ts` owns pairing and the active profile, through injected `fetch`, credential and profile stores, so it runs and is tested without Electron.

- **URLs** must be HTTPS. Plain HTTP is accepted only for a loopback address in development builds. User info, queries and fragments are refused, and redirects are never followed, so a token cannot be carried to another origin.
- **Identity first:** before any token is sent, the app reads `/api/v0/info`, checks that the protocol range includes version 0 and that the server is the one the profile was paired with, by server ID. A different server at the same address, or after an address change, is refused as `IDENTITY_MISMATCH`.
- **Pairing** sends the phrase, the device name and a command ID once. If the response is lost, pairing again with the same form repeats the same command, and the server returns the same device and token until the phrase expires. The phrase is kept only in main-process memory for that pending pairing.
- **Credentials:** the token is encrypted with Electron `safeStorage` and stored under a random handle in `userData/credentials`, apart from `userData/connections.json`, which holds only addresses and IDs. On Linux without a secret service (`basic_text`), the token lives only in memory for the session, and the profile shows its credential as missing after a restart.
- **States:** `unconfigured`, `connecting`, `pairing`, `online`, `offline`, `revoked` and `incompatible`, each with a problem code when something is wrong. A revoked device's token is deleted. Clearing a profile removes only local data; the server keeps the device until it is revoked there.

## Synchronization

`client-core/sync.ts` keeps a cache of the server's state while a connection is active, following [events](../../docs/server-api.md#events). It uses the same injected transport and runs without Electron.

- **One supervisor** follows the connection. Before every connection it checks identity, epoch and revocation, then works through three steps. First it confirms uncertain commands by their receipts. Then it takes a snapshot, or replays events after the saved cursor page by page. Finally it opens the SSE stream from that cursor. The state is `live` only once all three are done.
- **Events** only name what changed. Each batch refetches the runs, workflows, interactions or projects it names, merges them, and saves the cache together with the batch's last cursor. Duplicates and events at or before the cursor are skipped. A new epoch, `RESYNC_REQUIRED`, or an event type or version the client does not know drops the cache and takes a new snapshot.
- **Stale answers:** every fetch takes a ticket, and a resource only accepts an answer newer than the one it holds. A replaced or stopped connection cannot write at all.
- **Reconnecting:** a stream with no traffic for 45 seconds is closed. Reconnects back off from 0.5 s, doubling up to 30 s, and each wait keeps a random half as jitter. A stream that carries traffic resets the backoff. A revoked or incompatible server stops the retries. Revocation also deletes the cache.
- **Commands** get a new command ID once. If the answer is lost, the command is `unknown` (acknowledgement unknown) until its receipt is checked: right away if the server still answers, otherwise on reconnect. It becomes `accepted` or `not_applied`. Nothing is ever resent automatically. `resend` repeats the same ID and body when asked. Commands need a live connection; there is no offline write queue.
- **Storage:** `userData/sync/<profile>.json` (mode 0600) holds the cache and the IDs and states of uncertain commands. Command bodies stay in memory only, so after a restart an uncertain command can be checked but not resent. Clearing a profile deletes its file. The renderer gets only `sync.read`: the status, problem, last-updated time, cache counts and command states.

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

The smoke runs the actual built or packaged application. It checks the pairing step and its labelled fields, that no canvas shows before pairing, the exact bridge surface, disconnected resource and run requests, invalid requests, credential omission, CSP, network denial, overflow at the minimum window size, and window creation. It verifies the OS sandbox through Linux process status or Electron's macOS/Windows process metrics. Preload also refuses to expose its bridge unless sandboxing and context isolation are active. Temporary smoke profiles are removed after exit.

Electron cannot run as root with its sandbox enabled. The smoke tool handles a root Linux development container by copying only the app and Electron into an owned temporary directory and launching as `nobody` through `runuser`. The copied Chromium sandbox helper has its required root ownership and mode. Xauthority and profile files belong to that test user; the tool removes the directory afterwards. Normal desktop/CI users run directly. The application never passes `--no-sandbox`.

## Code boundaries

| Directory                | Responsibility                                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main`               | Electron lifecycle, custom scheme, asset allowlist, permissions/navigation, validated IPC dispatch, safeStorage credentials and the profile file.                                                          |
| `src/preload`            | A single CommonJS bundle exposing four named methods through contextBridge.                                                                                                                                |
| `src/client-core`        | Platform-independent connection and sync runtimes, URL rules, HTTP and SSE transport, credential/profile/cache interfaces and validated status queries. A replaced connection attempt cannot change state. |
| `src/client-ui`          | The React canvas shell: pairing, canvas, islands, graph model and routes. No Electron, Node, client-core implementation, or backend imports.                                                               |
| `src/shared`             | App-local IPC schemas, inferred types, safe errors, and explicit payload limits.                                                                                                                           |
| `src/protocol/generated` | Byte-identical server-owned types, standalone validators, schemas, and foundation fixtures. Regenerate from the root.                                                                                      |
| `tools`                  | Bundle inspection, the built/packaged smoke launcher and the screenshot capture tool.                                                                                                                      |
| `test`                   | Boundary and client-core regression tests running without Electron, and a live sync test against a real server on Linux.                                                                                   |

The bridge exposes `readShell`, `setSamples`, `queryServer`, `openDocumentation`, `connection.{read, pair, abandonPairing, connect, changeAddress, clear}`, `sync.read`, `data.{overview, workflow, version, run}`, `run.{start, cancel}` and `onChange`. Resource reads take IDs only, never paths, and their answers are checked by the generated protocol validators in main and again in preload; they may be up to 8 MiB and 48 levels deep. `onChange` carries no data: main signals that connection or synchronized state changed, at most every 50 ms, and the renderer reads again. Run commands go through the sync runtime, so a lost answer is confirmed by its receipt. Connection responses carry the state and public profile fields only; no token, handle or phrase ever crosses back to the renderer. Status queries allow only `info`, `health`, and `ready`, and return `DISCONNECTED` without an online connection. There is no arbitrary URL, command, channel, filesystem, or token interface. Opening documentation uses one fixed HTTPS destination in main. Main checks the owned webContents, top frame, and exact application document before dispatch. Requests are limited to 8 KiB, other responses to 256 KiB, and JSON nesting to 16 levels. Unknown fields, invalid discriminants, coercions, cycles, and non-JSON values fail validation. Raw exception messages never cross the bridge.

Main serves only build-listed files below the renderer directory using `shift://app/index.html`. It rejects unknown assets, methods, userinfo, ports, queries, and paths outside the directory. All assets carry CSP and MIME headers. Context isolation, sandboxing, and web security are enabled; Node integration, webviews, permissions, downloads, renderer networking, navigation, and child windows are disabled. The renderer uses system fonts and bundled scripts under `script-src 'self'` without eval or remote code.

`electron.vite.config.ts` checks the module graph before bundling. `tools/check-bundle.mjs` parses the emitted JavaScript with Acorn, checks preload imports and renderer code, rejects backend/native dependencies, and writes the asset allowlist. All JavaScript dependencies are bundled at build time, so the packaged ASAR contains `dist` and the app manifest, with no runtime node_modules. Server protocol drift checking remains mandatory.

## Platform evidence

Local Linux x64 build, strict type checks, tests, and actual built/packaged Electron smoke are recorded in [implementation progress](../../docs/implementation-progress.md). The [client CI workflow](../../.github/workflows/app.yml) builds and smoke-tests an unsigned unpacked application on matching runners:

- Linux x64: `blacksmith-4vcpu-ubuntu-2204`, with Xvfb.
- Windows x64: `blacksmith-4vcpu-windows-2025`.
- macOS x64: `macos-15-intel`, a GitHub runner; Blacksmith has no Intel Macs.
- macOS arm64: `blacksmith-6vcpu-macos-15`.

Runner labels match [Blacksmith's](https://docs.blacksmith.sh/blacksmith-runners/overview) and GitHub's published catalogs. Their availability to this repository and successful execution remain unverified until CI runs; missing runners are not skipped or treated as passing. This task did not trigger remote CI. Windows/macOS are untested locally. These unpacked packages are foundation smoke artifacts, not signed installers. Windows signing, macOS signing/notarization, Linux distribution artifacts, OS secret-service behavior, and minimum-OS validation remain release prerequisites in prompt 31.
