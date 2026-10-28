# Shift App

The Electron client opens a minimal shell: a disconnected status, six plain navigation buttons, and an empty section placeholder. The sections are Projects, Workflows, Runs, Sessions, Attention, and Settings. Development shows a fixture-mode label. There are no sample resource records, resource views, search, dialogs, icons, custom fonts, or product styling.

The app never starts a Shift server, harness, or agent. The main process can pair with a server, keep the device token in the OS keychain, reconnect, and keep a synchronized cache of the server's state. No screen uses this yet: the renderer still shows the disconnected shell. Views of the synchronized data and workflow editing are later milestones.

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
- **Reconnecting:** a stream with no traffic for 45 seconds is closed. Reconnects back off from 0.5 s, doubling up to 30 s, and each wait keeps a random half as jitter. A working stream resets the backoff. A revoked or incompatible server stops the retries. Revocation also deletes the cache.
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

The smoke runs the actual built or packaged application. It checks the six section placeholders, disconnected state, absence of product UI, invalid requests, credential omission, CSP, network denial, and window creation. It verifies the OS sandbox through Linux process status or Electron's macOS/Windows process metrics. Preload also refuses to expose its bridge unless sandboxing and context isolation are active. Temporary smoke profiles are removed after exit.

Electron cannot run as root with its sandbox enabled. The smoke tool handles a root Linux development container by copying only the app and Electron into an owned temporary directory and launching as `nobody` through `runuser`. The copied Chromium sandbox helper has its required root ownership and mode. Xauthority and profile files belong to that test user; the tool removes the directory afterwards. Normal desktop/CI users run directly. The application never passes `--no-sandbox`.

## Code boundaries

| Directory                | Responsibility                                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main`               | Electron lifecycle, custom scheme, asset allowlist, permissions/navigation, validated IPC dispatch, safeStorage credentials and the profile file.                                                          |
| `src/preload`            | A single CommonJS bundle exposing four named methods through contextBridge.                                                                                                                                |
| `src/client-core`        | Platform-independent connection and sync runtimes, URL rules, HTTP and SSE transport, credential/profile/cache interfaces and validated status queries. A replaced connection attempt cannot change state. |
| `src/client-ui`          | Minimal React shell and section selection. No Electron, Node, client-core implementation, or backend imports.                                                                                              |
| `src/shared`             | App-local IPC schemas, inferred types, safe errors, and explicit payload limits.                                                                                                                           |
| `src/protocol/generated` | Byte-identical server-owned types, standalone validators, schemas, and foundation fixtures. Regenerate from the root.                                                                                      |
| `tools`                  | Bundle inspection and built/packaged smoke launcher.                                                                                                                                                       |
| `test`                   | Boundary and client-core regression tests running without Electron, and a live sync test against a real server on Linux.                                                                                   |

The bridge exposes `readShell`, `setSamples`, `queryServer`, `openDocumentation`, `connection.{read, pair, abandonPairing, connect, changeAddress, clear}` and `sync.read`. Connection responses carry the state and public profile fields only; no token, handle or phrase ever crosses back to the renderer. Status queries allow only `info`, `health`, and `ready`, and return `DISCONNECTED` without an online connection. There is no arbitrary URL, command, channel, filesystem, or token interface. Opening documentation uses one fixed HTTPS destination in main. Main checks the owned webContents, top frame, and exact application document before dispatch. Requests are limited to 8 KiB, responses to 256 KiB, and JSON nesting to 16 levels. Unknown fields, invalid discriminants, coercions, cycles, and non-JSON values fail validation. Raw exception messages never cross the bridge.

Main serves only build-listed files below the renderer directory using `shift://app/index.html`. It rejects unknown assets, methods, userinfo, ports, queries, and paths outside the directory. All assets carry CSP and MIME headers. Context isolation, sandboxing, and web security are enabled; Node integration, webviews, permissions, downloads, renderer networking, navigation, and child windows are disabled. The renderer uses system fonts and bundled scripts under `script-src 'self'` without eval or remote code.

`electron.vite.config.ts` checks the module graph before bundling. `tools/check-bundle.mjs` parses the emitted JavaScript with Acorn, checks preload imports and renderer code, rejects backend/native dependencies, and writes the asset allowlist. All JavaScript dependencies are bundled at build time, so the packaged ASAR contains `dist` and the app manifest, with no runtime node_modules. Server protocol drift checking remains mandatory.

## Platform evidence

Local Linux x64 build, strict type checks, tests, and actual built/packaged Electron smoke are recorded in [implementation progress](../../docs/implementation-progress.md). The [client CI workflow](../../.github/workflows/app.yml) builds and smoke-tests an unsigned unpacked application on matching runners:

- Linux x64: `ubuntu-22.04`, with Xvfb.
- Windows x64: `windows-2022`.
- macOS x64: `macos-15-intel`.
- macOS arm64: `macos-15`.

Runner labels match GitHub's published catalog. Their availability to this repository and successful execution remain unverified until CI runs; missing runners are not skipped or treated as passing. This task did not trigger remote CI. Windows/macOS are untested locally. These unpacked packages are foundation smoke artifacts, not signed installers. Windows signing, macOS signing/notarization, Linux distribution artifacts, OS secret-service behavior, and minimum-OS validation remain release prerequisites in prompt 31.
