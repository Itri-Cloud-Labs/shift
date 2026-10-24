# Shift server

`shift serve` is the Linux server. It stores projects, versioned workflows and runs in SQLite, executes workflows durably, runs agents through a supervised OpenCode runtime, and gives each run its own Git worktree. It is administered through the `shift` CLI over a private Unix socket. Desktop clients pair with a one-time phrase and authenticate with device tokens over TCP; the device API for runs and SSE events are not implemented yet.

See [Workflows and runs](../../docs/workflows.md) for what a workflow can do and [Server API](../../docs/server-api.md) for every endpoint and CLI command.

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

Cleanup attempts both listeners, SQLite and the instance lock even when an earlier close fails, then reports a sanitized error. `stop()` and `stopped` expose the same completion promise so shutdown has one failure outcome.

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

The state directory must belong to the service account and have mode 0700. SQLite/WAL/SHM paths must be owned regular files without hard links. The administrative socket is `<state>/admin.sock`, mode 0600, and its path must fit Linux's Unix-socket limit. Shared network filesystems are outside the supported storage contract. Do not delete, relocate or replace a live state directory.

`<state>/instance.lock` is a persistent owned mode-0600 regular file without hard links. A Linux open-file-description lock, supplied by fs-native-extensions, excludes other descriptors/processes until its owning descriptor closes or the process dies. Filesystem permissions prevent unrelated accounts from opening or preclaiming it. The inode stays in place across shutdown and crashes; do not remove or replace it while a server is running. Unsafe files or an incompatible native lock binding fail startup before SQLite opens.

TCP exposes only `GET /api/v0/info`, `GET /api/v0/health` and `GET /api/v0/ready`. Health returns HTTP 200 for liveness, with a separate readiness value. Ready returns 503 while starting/stopping or when persistence is unavailable. Info/health include a stable server ID, stable event epoch, wire range 0..0, payload schema version 1 and request ID. Readiness never implies that unfinished future capabilities exist.

`POST /api/v0/admin/shutdown` exists only on the administrative socket. It accepts no body, rejects browser Origin headers and returns a validated 202 acknowledgement. There are no TCP administrative routes. TCP also serves pairing and the token-authenticated device routes ([server API](../../docs/server-api.md#devices)). `--public` explicitly exposes them beyond loopback; put a TLS-terminating reverse proxy in front, because device tokens travel in clear text over plain HTTP. Default startup remains loopback-only.

## Storage and protocol ownership

Startup verifies SQLite >=3.51.3 and records the runtime source ID, JSON support, integrity, WAL, FULL synchronization, foreign keys and a 5-second busy timeout. The selected native package runs SQLite 3.53.4. Migrations use Drizzle's synchronous migrator after checking the complete applied hash/order history. An edited migration, newer database or invalid metadata prevents readiness. Server ID and event epoch survive restart; worker generation changes. Feature tables are intentionally absent.

Pure source contracts live under `src/protocol/schemas`; deterministic public fixtures live under `test/fixtures/protocol`. `pnpm protocol:generate` updates server and app generated copies. `pnpm protocol:check` detects drift without modifying them. The generated app code/types/JSON do not import server modules, SQLite, Electron or Node APIs, and execute under a CSP-style no-eval test. Changes to a schema, fixtures and generated output must be reviewed together. Prompt 01 owns root toolchain/lockfile/CI and these contracts; prompt 02 owns its app implementation and proposes protocol changes before consumption.

Dependency scripts are explicitly allowed only for esbuild; better-sqlite3's automatic source build is disabled because the selected release ships x64/arm64 Linux prebuilds. fs-native-extensions 1.5.1 supplies Node-API Linux x64/arm64 prebuilds with no install script. A missing/incompatible prebuild fails clearly. Building a replacement native binding requires an operator/developer toolchain and the same patch/runtime checks. Workspace TypeScript stays strict; `skipLibCheck` avoids Drizzle's declarations for unused optional database drivers.

## Workflows and runs

```sh
shift serve --opencode-model openai/gpt-6-luna
shift project add --path /path/to/repo
shift workflow create --project <project-id> --name count-words --file docs/examples/count-words.json
shift workflow publish <workflow-id>
shift run start --workflow <workflow-id> --input '{"file":"notes.txt"}' --wait
shift run show <run-id>
shift workspace list
```

Agents run on your own OpenCode install, so any provider connected there works, including OAuth connectors. Each run works in its own detached worktree under `<state>/workspaces`, and your checkout is never modified. [Workflows and runs](../../docs/workflows.md) describes the document format, node types, bindings, agent results, workspaces and crash recovery. [Server API](../../docs/server-api.md) describes every endpoint, command ID semantics and error code.

## OpenCode harness

`src/harness` contains the OpenCode v2 runtime supervisor and adapter that `shift serve` uses for agent runs. The evidence behind each choice is in [OpenCode capabilities](../../docs/opencode-capabilities.md).

- One `opencode serve` runtime per Shift server. By default (`--opencode-environment host`) it runs as your own OpenCode install: it inherits your environment, minus `SHIFT_*` variables and OpenCode password variables, and uses your config, credentials, plugins, skills, MCP servers and session store. Shift adds its result plugin through `OPENCODE_CONFIG_CONTENT`, which OpenCode merges over your config, and never writes to your config or credentials. Agents therefore have whatever your OpenCode has, including every configured MCP server.
- `--opencode-environment isolated` runs it in the namespace `<state>/harness/opencode` instead, with a private `HOME`, XDG directories and `TMPDIR`. It then receives only those paths, `PATH` and `LANG`, and `SHIFT_OPENCODE_API_KEY` supplies its provider key, registered once. Tests and CI use this mode.
- The runtime runs inside a transient systemd scope named `shift-opencode-<namespace hash>-…`. Tool processes leave OpenCode's process group, so losing the runtime kills the whole scope. Every start first kills stale scopes of the namespace. The environment reaches systemd-run as its process environment, never as command-line arguments, which other accounts can read. The supervisor needs a systemd user manager (`systemd-run --user`); a system manager is selectable for a root service.
- The server password is generated by OpenCode and read from its stdout. Supplying it through the environment would expose it to every tool shell.
- Results arrive through the `shift_submit_result` plugin tool, which calls a loopback endpoint with a per-generation bearer token.

`pnpm --filter @shift/server test` includes supervisor tests and end-to-end run tests that drive real `shift serve` processes against scripted OpenCode stand-ins inside real scopes, killing either process mid-run; they skip without a systemd user manager unless `SHIFT_TEST_REQUIRE_SYSTEMD=1`, which CI sets. `pnpm --filter @shift/server test:opencode` runs the real-runtime integration test. It makes paid model calls on your own OpenCode install and its credentials, creating sessions in its store, and selects the model with `SHIFT_TEST_OPENCODE_MODEL` (default `openai/gpt-6-luna`). `SHIFT_TEST_OPENCODE_ENVIRONMENT=isolated` runs it in a private namespace instead, with an API key from `SHIFT_TEST_OPENCODE_KEY` or an API-key entry in `~/.local/share/opencode/auth.json`; OAuth entries are never copied into a namespace.

## Platform verification

The [server CI workflow](../../.github/workflows/server.yml) uses matching native `ubuntu-22.04` x64 and `ubuntu-22.04-arm` ARM64 runners, the pinned toolchain, frozen install, protocol/type/build/subprocess checks and the compiled platform smoke. Ubuntu 22.04/glibc 2.35 is the initial CI baseline. Runner availability and passing CI results must be checked before distribution; this local task does not trigger or fabricate GitHub runs.

The platform smoke accepts an expected architecture argument, for example `node apps/server/tools/platform-smoke.mjs arm64`. It verifies the actual Node/native SQLite runtime, required pragmas, HTTP schemas, private socket mode, instance exclusion and restart identity using temporary state. An emulated ARM64 result must be identified as emulated; it does not establish native kernel or packaged-release coverage.

The cross-account regression test launches an owned subprocess as `nobody`. Root can set that child's UID directly; a non-root test runner needs passwordless `sudo -u nobody`, available on the selected GitHub runners. This does not change host accounts or files outside the test's temporary directories.

For a non-root runner, sudo must authorize the actual test command: `sudo -n -u nobody -- <temporary-directory>/node <temporary-directory>/preclaim-lock.mjs <state-directory>`. Permission to run `id` alone does not establish this access. If `sudo` is missing or access is denied, install it through your platform's package manager and ask the runner administrator to provide the required access, or use a supported root runner. The test reports launch failures with a prerequisite diagnostic and the underlying error; it is not skipped. Avoid granting broad passwordless sudo access just to run the suite.

See [implementation decisions](../../docs/implementation-decisions.md) and [progress](../../docs/implementation-progress.md) for exact local evidence and later gates.
