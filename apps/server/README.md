# Shift server

The Linux server foundation runs without Electron or an agent harness. It provides identity, liveness/readiness, private local administration, a singleton lock and a migrated SQLite metadata store. Workflow execution, pairing, credentials and SSE arrive in later prompts and currently advertise unavailable capabilities.

Use Node 24.19.0 and pnpm 12.6.0 from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
```

`pnpm build` compiles the server into `apps/server/dist` and copies its migrations and pure protocol artifacts. Native SQLite remains an installed server dependency. `pnpm typecheck` also checks test helpers and generated-contract type assertions. `pnpm test` builds and runs real-database and subprocess tests. `pnpm dev` starts the source CLI through tsx, without a restart watcher that could hide lifecycle bugs.

`pnpm format` applies the pinned Prettier configuration to application source, tools, configuration and implementation documentation. `pnpm format:check` checks the same files and runs first in `pnpm check`. Protocol generation formats its own output before comparing or writing it. Applied migration files retain their original bytes and hashes.

For an isolated demonstration that starts/stops the server and validates its responses:

```sh
pnpm build
node apps/server/tools/platform-smoke.mjs
```

For an interactive server, create a private temporary directory and keep its printed path for another terminal:

```sh
SHIFT_DEMO_STATE=$(mktemp -d /tmp/shift-demo.XXXXXX)
echo "$SHIFT_DEMO_STATE"
node apps/server/dist/cli.js serve --state-dir "$SHIFT_DEMO_STATE" --port 4317
```

Then use that same directory with the local CLI:

```sh
node apps/server/dist/cli.js info --state-dir /tmp/shift-demo.REPLACE
node apps/server/dist/cli.js health --state-dir /tmp/shift-demo.REPLACE
node apps/server/dist/cli.js ready --state-dir /tmp/shift-demo.REPLACE
node apps/server/dist/cli.js stop --state-dir /tmp/shift-demo.REPLACE
```

`info`, `health`, `ready` and `stop` connect to the administrative socket. They never open a second writable database. Stop acknowledges the shutdown request; the serving process then drains/closes listeners, closes SQLite, and releases the lock. SIGINT/SIGTERM perform the same shutdown. The default deadline is 5 seconds and can be set between 100 and 30,000 milliseconds. A crashed process releases the kernel lock automatically; the next owner removes only a verified crash-left socket, never a regular file or symlink.

## Configuration and exposure

| Option                    | Environment equivalent        | Default                                                   |
| ------------------------- | ----------------------------- | --------------------------------------------------------- |
| `--state-dir`             | `SHIFT_STATE_DIR`             | `$XDG_STATE_HOME/shift`, or `~/.local/state/shift`        |
| `--host`                  | `SHIFT_HOST`                  | `127.0.0.1`                                               |
| `--port`                  | `SHIFT_PORT`                  | `4317`; `0` selects an ephemeral port                     |
| `--public`                | none                          | false; required for an IP other than `127.0.0.1` or `::1` |
| `--shutdown-timeout-ms`   | `SHIFT_SHUTDOWN_TIMEOUT_MS`   | `5000`                                                    |
| `--log-level`             | `SHIFT_LOG_LEVEL`             | `info`; also debug/warn/error/silent                      |
| `--sqlite-native-binding` | `SHIFT_SQLITE_NATIVE_BINDING` | bundled platform prebuild                                 |

Flags override their environment equivalents. Hosts are literal IP addresses; DNS listener names are rejected. Administrative commands accept only `--state-dir`. Relative explicit state paths resolve against the current directory. `XDG_STATE_HOME`, when present, must be absolute. Configuration errors report field names and safe messages, not submitted values.

The state directory must belong to the service account and have mode 0700. SQLite/WAL/SHM paths must be owned regular files without hard links. The administrative socket is `<state>/admin.sock`, mode 0600, and its path must fit Linux's Unix-socket limit. Shared network filesystems and separate network namespaces accessing one state directory are outside this singleton-lock contract. Do not delete, relocate or replace a live state directory.

TCP exposes only `GET /api/v0/info`, `GET /api/v0/health` and `GET /api/v0/ready`. Health returns HTTP 200 for liveness, with a separate readiness value. Ready returns 503 while starting/stopping or when persistence is unavailable. Info/health include a stable server ID, stable event epoch, wire range 0..0, payload schema version 1 and request ID. Readiness never implies that unfinished future capabilities exist.

`POST /api/v0/admin/shutdown` exists only on the administrative socket. It accepts no body, rejects browser Origin headers and returns a validated 202 acknowledgement. There are no TCP administrative routes or enrollment tokens. `--public` explicitly exposes the read-only discovery endpoints; HTTPS/reverse-proxy setup and authenticated remote operations belong to later prompts. Default startup remains loopback-only.

## Storage and protocol ownership

Startup verifies SQLite >=3.51.3 and records the runtime source ID, JSON support, integrity, WAL, FULL synchronization, foreign keys and a 5-second busy timeout. The selected native package runs SQLite 3.53.4. Migrations use Drizzle's synchronous migrator after checking the complete applied hash/order history. An edited migration, newer database or invalid metadata prevents readiness. Server ID and event epoch survive restart; worker generation changes. Feature tables are intentionally absent.

Pure source contracts live under `src/protocol/schemas`; deterministic public fixtures live under `test/fixtures/protocol`. `pnpm protocol:generate` updates server and app generated copies. `pnpm protocol:check` detects drift without modifying them. The generated app code/types/JSON do not import server modules, SQLite, Electron or Node APIs, and execute under a CSP-style no-eval test. Changes to a schema, fixtures and generated output must be reviewed together. Prompt 01 owns root toolchain/lockfile/CI and these contracts; prompt 02 owns its app implementation and proposes protocol changes before consumption.

Dependency scripts are explicitly allowed only for esbuild; better-sqlite3's automatic source build is disabled because the selected release ships x64/arm64 Linux prebuilds. A missing/incompatible prebuild fails clearly. Building a replacement native binding requires an operator/developer toolchain and the same patch/runtime checks. Workspace TypeScript stays strict; `skipLibCheck` avoids Drizzle's declarations for unused optional database drivers.

## Platform verification

The [server CI workflow](../../.github/workflows/server.yml) uses matching native `ubuntu-22.04` x64 and `ubuntu-22.04-arm` ARM64 runners, the pinned toolchain, frozen install, protocol/type/build/subprocess checks and the compiled platform smoke. Ubuntu 22.04/glibc 2.35 is the initial CI baseline. Runner availability and passing CI results must be checked before distribution; this local task does not trigger or fabricate GitHub runs.

The platform smoke accepts an expected architecture argument, for example `node apps/server/tools/platform-smoke.mjs arm64`. It verifies the actual Node/native SQLite runtime, required pragmas, HTTP schemas, private socket mode, instance exclusion and restart identity using temporary state. An emulated ARM64 result must be identified as emulated; it does not establish native kernel or packaged-release coverage.

See [implementation decisions](../../docs/implementation-decisions.md) and [progress](../../docs/implementation-progress.md) for exact local evidence and later gates.
