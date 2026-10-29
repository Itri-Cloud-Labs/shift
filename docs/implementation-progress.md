# Implementation progress

## 00. Preflight dependency review and initial contracts

Status: complete. Date: 2026-10-03. Scope: the owner's request to execute `docs/prompts/00-preflight.md`.

Changed files are [implementation-decisions.md](implementation-decisions.md), this progress log, and the [documentation index](README.md). Read both specifications, the actual manifests/lockfile/workspace layout, COMMON, parallel ownership rules, and prompts 01-03. Reviewed current maintainer documentation/source and publisher version records. Application manifests and lockfile remain unchanged.

Acceptance coverage:

- Concrete workflow/job alternatives, their database/recovery requirements, versions, and maintenance evidence are recorded. Custom domain execution/store logic is justified; transactional SQLite queue reuse remains a mandatory prompt-05 probe before implementing jobs.
- The two-workspace decision overrides the expanded roadmap wording. Server-owned schemas, deterministic generated pure app artifacts, fixture ownership, drift checks, bundle/import checks, and concurrent root/contract ownership are specified.
- Inputs, outputs and verification gates for 01, 02 and 03 are explicit. Protocol families, receipts, identity, snapshot/high-water mark and epoch rules are frozen at the initial design level. Deferred endpoint details, adapter assumptions, compatibility checks, and operator release prerequisites have named dependent prompts.

Checks and results:

- Repository inspection found only manifests/documentation and no application scripts or dependencies. Observed Node 24.19.0, pnpm 12.6.0, Linux x64, glibc 2.39.
- An isolated pnpm install with scripts disabled loaded better-sqlite3 13.0.3 and runtime SQLite 3.53.4. Real temporary database checks passed WAL/FULL/foreign keys/busy timeout, synchronous Drizzle migration/journal, immediate transaction rollback and committed-row persistence after reopen.
- Minimal Ajv 2020-12 validation, standalone ESM output, simple generated TypeScript shape and split-CRLF SSE parsing passed with exact versions recorded in the decision document.
- Cron-parser's observed spring-forward shift contradicts Shift's skip policy. This is an expected library-policy mismatch, assigned to the wrapper tests in 25.
- Extracted and ran the native demonstration shell block from the decision document. It passed on Node 24.19.0/Linux x64/SQLite 3.53.4. Local Markdown links, code fences and required-topic coverage passed. `git diff --check` passed.

Reproduction: run the isolated native-binding demonstration in [the decision document](implementation-decisions.md#evidence-checks-and-reproduction). It creates temporary resources and performs no server or release action.

Remaining checks belong to later prompts: final dependency pins/builds, generated Shift schemas and bundle enforcement, subprocess crash persistence/locks, arm64 and packaged desktop OS smoke tests, form/history/queue adoption probes, actual OS credential services, and real OpenCode/provider/GitHub integration. No current application build/test commands exist. Preflight completion establishes review/contract readiness for 01/02; it does not establish implementation or release readiness.

## 01. Linux server foundation

Status: complete for the local foundation. Date: 2026-10-03. Scope: the owner's request to execute `docs/prompts/01-server-foundation.md`. Native ARM64 CI and release packaging remain unverified platform gates.

Changed files include the root toolchain/scripts/lockfile and Linux CI workflow, `apps/server` source/configuration/build tools/tests/README, generated pure protocol artifacts in both workspaces, the root README, and the decision/progress documents. The app manifest is unchanged. Server-owned schemas and fixtures generate deterministic types and standalone validators; no server or native dependency enters the app artifacts.

Acceptance coverage:

- The source and compiled CLI start a headless loopback server. Info and health return validated identity, event epoch, wire range 0..0, schema version 1 and readiness. Liveness remains HTTP 200 when persistence fails; readiness returns 503. Configuration, safe errors, redacted logging and the injected clock are implemented.
- A private mode-0600 administrative socket supports info/health/ready/shutdown. TCP exposes only read-only discovery routes and requires explicit public opt-in beyond loopback. The Linux kernel lock rejects another process, including a state-directory path alias, before database mutation. Graceful shutdown and SIGKILL release ownership; restart preserves server ID and event epoch.
- Real SQLite initialization verifies runtime version/source ID, JSON support, integrity and WAL/FULL/foreign keys/busy timeout. Synchronous Drizzle migrations and durable metadata are the only tables. Edited/ahead migration history, corrupt metadata, unsafe paths, incompatible native loading and invalid configuration fail safely. Async I/O stays outside persistence transactions.
- Strict workspace type checks, build, startup/shutdown and real-database subprocess tests pass. No workflow executor is required for readiness; commands/events/pairing and harness/node catalogs remain unavailable until their owning prompts.

Checks and results:

- `pnpm install --frozen-lockfile` passed with the explicit dependency-build policy. Node 24.19.0, pnpm 12.6.0 and exact dependency pins are recorded in the manifests and [decisions](implementation-decisions.md#01-foundation-implementation-choices).
- `pnpm check` passed: deterministic protocol drift check, strict type check, compiled build and all 15 tests, with zero failures/skips. Tests cover real SQLite migration rollback, committed identity across restart, SIGKILL during an uncommitted transaction, duplicate subprocess exclusion, stale administrative socket recovery, bounded shutdown with an incomplete HTTP request, safe exposure/errors/redaction and readiness failure. Browser-target generated validators bundle without server imports and run with dynamic code generation disabled.
- `pnpm --filter @shift/server dev --state-dir <temporary-directory> --port 0` started successfully. The compiled CLI returned validated info and stopped that process. Compiled CLI serve/info/stop also passed independently.
- `node apps/server/tools/platform-smoke.mjs x64` passed locally and in an isolated Ubuntu 22.04 container with glibc 2.35. Observed runtime SQLite was 3.53.4, source ID `2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc`; required pragmas, HTTP validation, socket permissions, instance exclusion and restart identity passed.
- The compiled platform smoke passed on ARM64 Node 24.19.0 with the same SQLite runtime through QEMU user-space emulation in an isolated ARM64 Debian container. This verifies that addon/runtime path under emulation, not native kernel or packaged ARM64 behavior. The workflow runs frozen install, protocol/type/build/tests and this smoke on native x64/ARM64 Ubuntu 22.04 runners; no GitHub run was triggered by this task.
- After adding esbuild to the generator-version manifest, protocol regeneration/drift checking passed again. `git diff --check` passed. Temporary server processes, state and verification containers were removed.

Reproduction from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
node apps/server/tools/platform-smoke.mjs
```

The smoke uses temporary state and closes/removes it. Interactive CLI commands, flags/environment variables, filesystem and namespace requirements are documented in [the server README](../apps/server/README.md).

Handoff: prompt 02 can consume the generated foundation artifacts without importing the server; coordinate any schema/fixture changes with server ownership. Feature tables, commands/receipts, pairing/authentication, SSE and execution remain assigned to later prompts. Run native ARM64 CI before distribution; packaged platforms, remote authenticated operations and production deployment are not established by this milestone. No commit, PR, deployment or release was created.

Formatting follow-up, 2026-10-03: formatted the foundation source, tests, tools, schemas, fixtures and implementation documentation with pinned Prettier 3.9.9. Added shared configuration, `pnpm format`/`format:check`, enforcement in `pnpm check`, and formatter integration in protocol generation. Applied migrations retain their original bytes. Moved a type-error assertion comment to its property so it survives line wrapping. The expanded `pnpm check` passed formatting, deterministic generation, strict types, build and all 15 tests with zero failures/skips. Frozen install and `git diff --check` also passed.

PR #4 review follow-up, 2026-10-03: Greptile reported an abstract-socket preclaim attack, cleanup skipping later resources after a close error, and duplicate shutdown promise rejections. Regression subprocesses reproduced the failures before the fixes. Replaced the abstract lock with an owned mode-0600 persistent file and Linux OFD locking through pinned fs-native-extensions 1.5.1. Unified startup/shutdown cleanup so every listener, SQLite and lock release is attempted, preserving sanitized failures; `stop()` and `stopped` now share one promise. Added coverage for concurrent initial ownership, unsafe lock paths/permissions, a real `nobody` preclaim process, injected listener/database failures, lock release and unhandled rejections. The final `pnpm check` passed all 20 tests with zero skips/failures, frozen install passed, and the compiled x64 platform smoke passed. Native x64/ARM64 CI had passed on the original PR head; the new native dependency also requires those jobs on the updated head. Runtime protocols and migrations are unchanged. See [the PR](https://github.com/Itri-Cloud-Labs/shift/pull/4) and the updated server README/decision log for the ownership contract and dependency rationale.

## 02 client foundation

The original UI described below was removed on 2026-10-04 following the owner's scope correction. See the correction entry for the current minimal shell.

Completed locally, 2026-10-03. Executed `docs/prompts/02-client-foundation.md` after reading COMMON, client sections 1-3/7-9, server section 15, the preflight choices, and the implemented protocol artifacts. The worktree was clean at the start. There are still exactly two workspaces.

Implemented the Electron/React/Vite/TypeScript app under `apps/app`, with main, preload, client-core, client-ui, app-local IPC schemas, and the unchanged generated server protocol. Main serves build-listed bundled assets through `shift://app/index.html`. The sandboxed isolated preload exposes four validated methods. Main checks the owned sender/top frame/exact document, operation discriminants, closed payload shapes, and byte/depth limits. Renderer Node integration, arbitrary networking/filesystem access, permissions, downloads, unexpected navigation, and child windows are denied. Credentials stay behind an injected main/core interface; raw private exceptions and unknown protocol fields fail validation.

The disconnected shell includes Projects, Workflows, Runs, Sessions, Attention, and Settings. Deterministic samples have a persistent visible label, can be hidden, and are separate from advertised server capabilities. Packaged builds default to no samples. Project selection, resource search, read-only dialogs, keyboard focus restoration, and the narrow desktop layout work. Create/start/respond controls are disabled. The composition does not create a server, harness, agent, or live connection. Pairing, authenticated HTTP/SSE, credential persistence, workflow editing, and execution remain assigned to later prompts.

Changed root scripts to build/typecheck/test both workspaces while keeping `pnpm dev` as the server command and adding `app:dev`, `app:package`, and `app:smoke`. Added pinned dependencies, lockfile entries, graph/AST bundle checks, matching-OS CI, and app/root developer instructions. All app dependencies compile into the output; the ASAR contains the application manifest and `dist`, without runtime node_modules or native SQLite/backend modules. The bundled font retains its OFL license. Dependency versions, considered alternatives, sandbox preload and ESM entry choices are recorded in the decision log.

Verified:

- `pnpm install --frozen-lockfile` passed. A separate fresh temporary two-workspace install with the same manifests/lockfile passed, followed by Electron 44.5.1's first-launch binary download and executable lookup. Electron 44 has no postinstall download script. The temporary installation was removed.
- `pnpm check` passed formatting, deterministic protocol drift checking, both strict TypeScript projects, all app build entries, bundle inspection, and 29 tests: 20 server regressions and 9 client boundary/core tests, with zero failures/skips. After the additional dialog-focus correction, app typecheck/build/tests and both native smoke modes passed again. Server sources, migrations, canonical contracts and generated copies were unchanged.
- Client tests rejected malformed/coerced/extra-field IPC, invalid byte/depth/non-JSON values, foreign webContents/subframes/documents, unsafe assets/external links, unconfigured queries, private errors, secret-bearing server payloads, wrong server identity, and delayed responses after disconnect. Core ran against injected transport/credential fakes without Electron. Public generated files stayed byte-identical to the server copies.
- `pnpm --filter @shift/app build` passed all main/preload/renderer builds and module-graph/Acorn bundle checks. The renderer has five allowlisted entry/script/style/font assets. The single CommonJS preload imports only Electron. Linux x64 unsigned unpacked packaging through electron-builder passed; inspection of `resources/app.asar` found no node_modules or native backend files.
- `xvfb-run -a pnpm app:smoke` and `xvfb-run -a pnpm --filter @shift/app smoke:packaged` passed using real Electron 44.5.1 on Linux x64/glibc 2.39, running as the unprivileged `nobody` account with Chromium sandboxing enabled. The smoke verified Linux renderer `NoNewPrivs=1`/`Seccomp=2`, successful preload isolation checks, all six screens, sample toggling, empty packaged defaults, search, modal focus/Escape/restoration, disabled mutations, network/eval denial, blocked navigation/window creation, credential omission, and no horizontal overflow at 780px. An actual Electron capture was inspected. Temporary profiles and staged binaries were removed.
- `git diff --check` passed. The separate T3 browser preview could not obtain a usable snapshot; it is not counted as UI evidence. Its owned tab and development server were closed. Native Electron capture and assertions established local UI behavior instead.

The host initially lacked GTK desktop libraries; installed GTK/NSS/audio/GBM/Xss dependencies for the local smoke. The container has no desktop DBus service and Electron emitted DBus diagnostics. This milestone stores no credentials and makes no claim about a working OS secret service.

Configured `.github/workflows/app.yml` for native Ubuntu 22.04 x64, Windows 2022 x64, macOS 15 Intel x64, and macOS 15 arm64. Each matching runner asserts its platform/architecture, installs the frozen lockfile, checks formatting/protocol/types/tests, builds an unsigned unpacked app, and executes packaged smoke. Runner labels match GitHub's catalog, but repository runner availability and CI results are unverified because no remote job was triggered. Windows/macOS are unavailable in this local Linux environment and remain untested. Signing/notarization, installers/distribution formats, minimum OS coverage, and real credential-service/restart behavior remain release prerequisites for prompt 31.

Reproduction on a desktop:

```sh
pnpm install --frozen-lockfile
pnpm app:dev
```

For headless Linux verification after installing the desktop libraries and Xvfb:

```sh
pnpm check
pnpm app:package
xvfb-run -a pnpm app:smoke
xvfb-run -a pnpm --filter @shift/app smoke:packaged
```

See [the app README](../apps/app/README.md) for code boundaries and root-container test staging. No commit, PR, release, or deployment was created by this prompt.

### 02 scope correction, 2026-10-04

The owner rejected the designed resource UI as beyond a simple shell. Removed its layout/theme, resource views, fabricated resource/catalog data, search, project selection, detail dialogs, icons, custom fonts, sample browsing controls, browser preview, and screenshot artifact. Removed Radix Dialog, Lucide React, and Fontsource from the manifest/lockfile. Replaced the renderer with disconnected status, plain navigation for the six named sections, and an empty placeholder. Development displays the deterministic fixture-mode flag. No product UI design has been implemented.

Kept the Electron/main/preload/client-core boundaries, validated narrow IPC, controlled custom scheme, sandbox, CSP, bundle checks, injected transport/credentials, server-owned protocol fixtures, and platform CI. Simplified the app-local shell schema and fixture to connection status and fixture mode; it no longer invents resource contracts. Updated native smoke to exercise section selection and security while checking that product UI controls are absent. Updated the app README and current decisions to reflect the removal. The earlier UI description above is historical.

Verification after removal: app typecheck, all 9 client boundary/core tests with zero failures/skips, bundle inspection, Linux x64 packaging, and both built/packaged sandboxed Electron smoke passed. The smoke exercised all six plain section placeholders and confirmed that resource rows, search inputs, dialogs, and sidebars are absent. Frozen install, formatting and `git diff --check` passed. Server code and generated public contracts were untouched; server tests were not rerun for this UI removal. Windows/macOS smoke was not run locally.

## 03. OpenCode v2 capability probe

Status: complete for OpenCode v2.0.26 on Linux x64. Date: 2026-10-16. Scope: the owner's request to run the OpenCode probe ahead of further engine work, with approval for real model calls.

Changed files are the probe [script](../apps/server/tools/opencode-probe/probe.mjs) and [result plugin](../apps/server/tools/opencode-probe/plugin/index.mjs), a `probe:opencode` server script, the [capability findings](opencode-capabilities.md), the decision log, the documentation index and this entry. Production server code, protocol artifacts, migrations and the app are unchanged. No new dependency was added. The probe uses the server's existing Ajv.

Acceptance coverage:

- The probe is rerunnable. It isolates `HOME`, XDG paths and `TMPDIR`, starts its own `opencode serve`, verifies process ownership through the process environment before signalling, kills only marker-tagged orphaned tool processes whose cwd is inside its tree, and removes its temporary directory. Both full runs reported zero remaining probe processes.
- Findings separate documented v2 behavior (beta plugin API, experimental HTTP API), observed behavior (14 cases) and unresolved assumptions.
- Resume, correlation, terminal results, cancellation and tool policy each have case evidence: `idle-shutdown-resume`, `crash-after-ack`, `prompt-id-dedup`, `structured-result-correction`, `structured-blocker`, `interrupt-active-tool`, `read-only-policy`, `edit-deny-shell-bypass`, `permission-ask` and `question-form`.
- No essential capability is missing. Native structured output is absent but adapter-translated through a plugin result tool with in-turn correction. Two findings block a safe real adapter until implemented: tool processes escape the server's process group after a crash (cgroup containment required), and OpenCode relabels crashed tools as interrupted even when their effects completed.

Checks and results:

- `node apps/server/tools/opencode-probe/probe.mjs --out <file>` with `opencode-go/claude-haiku-5-5`: the final run observed all 14 cases, exit 0, $0.004679. The previous run observed 13. Its `permission-ask` failure was a probe assertion expecting 200 where OpenCode returns 204, since corrected. A no-model subset (`--only session-identity,prompt-ack-and-transcript,event-replay`) also passed.
- `pnpm check` passed formatting, protocol drift, both type checks, the app build and all 29 tests (20 server, 9 app) with zero failures or skips. `git diff --check` passed. The probe is not part of `pnpm check` because it needs OpenCode and a paid model credential.

Limitations: no OpenCode v2 behavior used by the adapter is documented as guaranteed. The probe callback is unauthenticated loopback HTTP, cgroup containment is untested, and the cases listed in [section 6 of the findings](opencode-capabilities.md#6-unresolved-and-unverified) were not exercised. Proposed specification changes are listed in [section 7](opencode-capabilities.md#7-proposed-specification-changes) and have not been applied.

PR #7 review follow-up, 2026-10-17: Greptile reported eight probe and documentation issues. Fixed: `event-replay` now creates an event after its cursor before reconnecting and asserts that no SSE `id:` fields are sent. `structured-result-correction` requires the accepted call to be a completion with schema-valid data. `question-form` asserts the missing `idle` record, the null session outcome and the aborted assistant reply. `crash-after-ack` retries up to three times until the kill lands before delivery, resubmits the original message ID, and reports `inconclusive` instead of `observed` if the race is never won. API requests have a 30-second deadline that covers body reads. Cleanup now kills every process that inherited the namespace `XDG_DATA_HOME`, plus members of marker-tagged tool process groups, and waits for them to exit before counting. `interrupt-active-tool` verifies that untagged tool children such as `sleep` carry that environment. The classification table in the findings now checks pending harness prompts before the general running state. Reply checks now read assistant messages explicitly. The reported match against user instructions was not reachable, because user messages keep their prompt in `text` rather than `content`. The rerun observed all 14 cases, exit 0, $0.006871, with zero remaining processes and no temporary directory.

## OpenCode runtime supervisor and adapter

Status: complete for the harness layer. Date: 2026-10-17. Scope: the owner's request to build the supervised OpenCode adapter (PR A of the end-to-end slice), after approving the probe's specification changes with one namespace per Shift server.

Changed files: `apps/server/src/harness` (contract types, systemd scope containment, and the OpenCode namespace, client, result endpoint, permission compiler, invocation classifier, runtime supervisor and adapter), unit, supervisor and opt-in integration tests with a fake `opencode` executable, a `test:opencode` script, the server CI workflow, the server README, the specification (sections 6.4, 6.5, 9 and 11.2), the capability findings and the decision log. The supervisor is not wired into `shift serve`; AgentService, its tables and the run slice are next.

Acceptance coverage:

- Containment: a process that escapes with `setsid` outlives its killed parent and is removed when its scope is killed. A lost runtime's tool process is killed before the next generation starts. A second supervisor on the same namespace reaps the scope of one that was never stopped, as after a Shift crash. A runtime that cannot start fails with `HARNESS_START_FAILED` and leaves no scope.
- Isolation: the runtime receives only `PATH`, `LANG` and namespace paths. Neither the server password, bus addresses nor inherited variables reach it. The plugin config is mode 0600 and carries a fresh endpoint token per generation. Credentials are provisioned once.
- Against real OpenCode 2.0.26: session creation is idempotent and rejects a conflicting identity; a goal ends with a structured result accepted by Shift's handler; read-only invocations write artifacts but not the repository; cancellation stops the turn, its tool processes and queued input; losing the runtime kills its tools before their effect happens and the invocation is classified `unknown`.
- New OpenCode findings were added to the capability document: `--port 0`, tool shells inheriting the server environment and `OPENCODE_SESSION_ID`, and lazy agent loading per location.

Checks and results:

- `pnpm --filter @shift/server test:opencode` with `opencode-go/claude-haiku-5-5`: all 5 subtests passed, with no remaining scopes or temporary directories. The first run failed the conflict subtest because agent lookups for a new directory return 404 until the location boots, which the adapter now waits for.
- `pnpm check` passed formatting, protocol drift, both type checks, the app build and 44 tests (35 server, including 10 harness unit and 5 supervisor tests in real systemd scopes, and 9 app) with zero failures or skips. `git diff --check` passed.

Limitations: the CI user-manager setup is unverified until the workflow runs. Results are recorded only in memory by the test handlers until AgentService persists them. The in-turn rejection limit, artifact collection and recovery continuations are AgentService work. Idle shutdown policy is not implemented; `stop()` and restart are.

PR #8 review follow-up, 2026-10-17: Greptile reported six issues, all valid. Fixed: a submission disconnecting mid-body rejected inside the async request listener and would have terminated Shift; the listener now contains every failure (a regression test fails with `aborted` on the previous code). The result tool accepted only object `data`, although business data may be any JSON value; it is now unrestricted, and a real-runtime subtest submits an array. A runtime that died after answering its last startup request could be published as current; startup now rejects a generation that has ended. A replaced provider key was ignored because OpenCode cannot change a stored key; the supervisor adds the new key and deletes outdated entries. A failed scope kill skipped closing the result endpoint; both stop and loss cleanup now close it regardless. Message paging was untested, and testing it found a real bug: OpenCode rejects a cursor combined with `order`, so any transcript longer than one page failed inspection. The adapter now sends `order` only on the first page, a unit test enforces OpenCode's rule, and the integration test re-inspects with one message per page. `pnpm test:opencode` passed all 6 subtests.

## First durable agent run

Status: complete for the slice. Date: 2026-10-17. Scope: the owner's request for PR B, a manual -> agent -> end run on SQLite that survives killing Shift or OpenCode.

Changed files: migration 0001 and its journal entry, `apps/server/src/runs` (result envelope, prompts, repository, agent service and engine), the harness contract (`correlate`, `storageNamespace`), server composition, administrative run routes, the administrative client, CLI `run start|show|list` and harness `serve` options, configuration, the scripted OpenCode stand-in, engine, end-to-end and opt-in real-runtime tests, the server and root READMEs, the decision log and this entry.

Acceptance coverage:

- Engine tests on real SQLite with a scripted harness: completion advances to the end node in one commit; an invalid result is rejected in the turn and corrected; a turn without a result gets a correction; exhausted corrections fail with `RESULT_MISSING`; a blocker fails as `blocked`; a harness prompt is cancelled and reported; an unknown outcome needs a human and is never retried; a turn interrupted without effects continues in the same session; a duplicate tool call is recorded once; results for an inactive session are rejected; after a crash an intent never received is submitted once with the same ID; an undelivered prompt is woken with the same ID; an ended turn with an accepted result completes without resubmitting; a graceful stop cancels and the restart continues; a stale fence cannot advance the run; invalid requests store nothing.
- End-to-end with real `shift serve`, CLI and systemd scopes against the stand-in: a run completes; killing Shift during tool work kills the tool and reports `HARNESS_OUTCOME_UNKNOWN` with nothing resubmitted; killing Shift before the first step continues the session; a graceful stop interrupts and the restart continues; killing OpenCode during tool work kills the tool and reports an unknown outcome.
- Against real OpenCode 2.0.26 and `opencode-go/claude-haiku-5-5` (`test:opencode`): a read-only run counted 4 words and completed with schema-valid data; SIGKILL of Shift during a 15-second shell command killed the command on restart, the command's file was never written, and the run entered `NEEDS_HUMAN`. A manual CLI demonstration showed the same, and that a second `serve` on the same state directory is refused.

Checks and results: `pnpm check` passed formatting, protocol drift, both type checks, the app build and 69 tests (60 server, 9 app) with zero failures or skips. `pnpm --filter @shift/server test:opencode` passed the adapter suite and the new run suite. The first full run exposed a timing race in the end-to-end test that kills Shift before the first step: the surviving harness finished its turn before the restart reaped it. Recovery handled that correctly with a correction prompt, so the test now freezes the harness before killing Shift and passed three consecutive runs.

Limitations: `NEEDS_HUMAN` has no repair commands yet. A Shift restart interrupts running turns instead of reconnecting. Runs have no projects, workflows or workspaces, and artifacts are not collected. The engine has no general job queue; that choice stays open for M03. Run admission has no command receipts, so a CLI retry after a lost response could start a second run.

PR #9 review follow-up, 2026-10-17: Greptile reported seven issues, all valid, each now covered by a test that fails on the previous code. An accepted result was discarded when the turn then ended as interrupted or unknown, or was gracefully stopped; an accepted result is now authoritative once the turn no longer runs. The harness-prompt branch ignored an unconfirmed cancellation and failed the node; an unconfirmed stop now keeps the run in `NEEDS_HUMAN`. Wrapping the author's schema in the envelope broke local `$ref`s; the business schema is now compiled at its own root in its own Ajv instance, so `$id`s of different runs cannot collide either. The rejection limit only changed the message; reaching it now cancels the turn and leads to a correction. `engine.stop()` could wait on a stalled harness request; shutdown now bounds it by `--shutdown-timeout-ms`, then kills the runtime scope. A stale runtime survived a restart with no pending work; startup now reaps stale scopes. The administrative client's 1 MiB response limit was below a valid run view, which repeats its result; it is now 16 MiB. `pnpm check` passed 74 tests (65 server, 9 app) with zero skips, and `test:opencode` passed all 10 subtests against real OpenCode.

Second review round, 2026-10-17: Greptile found that a task left running past the shutdown deadline could call `runtime.ensure()` from its cancellation path after `runtime.stop()`, starting a new OpenCode runtime after Shift had released its lock. `stop()` now closes the supervisor permanently and `ensure()` rejects with `HARNESS_STOPPED`; the lingering task's signal is already aborted, so it records nothing. A supervisor test covers it, and the credential-replacement test now uses a new supervisor for the restart, as a real restart would.

Third review round, 2026-10-17: Greptile kept the shutdown-deadline finding open, correctly. Each shutdown phase had its own full budget (engine, then the runtime's graceful exit, then listeners), so a wedged harness could hold shutdown for about three budgets. The server now computes one deadline and gives each phase only the remaining time; `runtime.stop()` also bounds its wait for a pending start, and a start that completes after stop kills itself instead of publishing. A new end-to-end test uses a harness that never answers the interrupt and ignores SIGTERM: with a 2-second budget, the process exits within 3 seconds of the acknowledged stop and the tool is killed; the previous code took 4.2 seconds. While measuring, the CLI turned out to take about 2 seconds to start because it statically imported SQLite and the server graph; it now loads the server only for `serve` (`shift help` starts in about 0.6 seconds). `pnpm check` passed 76 tests (67 server, 9 app) with zero skips.

Fourth review round, 2026-10-17: Greptile kept the deadline open for one remaining case, shutdown while OpenCode is still starting. `runtime.stop()` waited for a pending start only for its budget; a start still waiting for OpenCode's startup lines was left running after Shift released its lock, until the next startup reaped it. The supervisor now records the scope of a spawned but unpublished generation, and `stop()` kills it at the deadline, so the pending start fails on the exit and closes its endpoint. A supervisor test with a fake that never prints its startup lines fails on the previous code and passes now. `pnpm check` passed 77 tests (68 server, 9 app) with zero skips.

Fifth review round, 2026-10-17: a start that was still preparing (systemd check, stale-scope reaping, endpoint and namespace setup) when `stop()` ran had no scope to kill yet, and went on to spawn OpenCode after shutdown finished. The start now checks the closed flag after its last await, in the same synchronous step that records the starting scope and spawns, so `stop()` either aborts the start or finds the scope to kill. A supervisor test that holds the start in preparation fails on the previous code (OpenCode was spawned) and passes now. `pnpm check` passed 78 tests (69 server, 9 app) with zero skips.

## Definitions and general linear execution

Status: complete for M02 and M03 as scoped with the owner. Date: 2026-10-17.

Changed files: migration 0002 and journal entry; `apps/server/src/workflows` (document format, node registry, definitions repository and service); `src/persistence/receipts.ts`; the run repository, engine, agent service and new `bindings.ts`; administrative routes, the administrative client and `src/cli-admin.ts` for `project`, `workflow` and `run` commands; the queue probe tool; tests; the example workflow; the server and root READMEs; and the decision log. The `run start --goal --repo` form of the fixed-graph slice is replaced by `run start --workflow`.

Acceptance coverage:

- Definitions: projects register the canonical top level of an existing repository and verify the base ref; drafts are compare-and-swap; publishing validates and numbers versions, an unchanged draft is not renumbered, and database triggers keep versions immutable. Seventeen validation rules each have a failing document.
- Execution: transform chains with every binding source; leaf completion; an End node's declared failed outcome; binding failures routed through an `error` connection with the failed execution kept in history; an agent blocker routed to an error handler; a self-loop stopping at its execution limit with `latest` reading the previous pass; trigger input validated and rendered into the agent goal; runs keeping their version after a republish; a repeated start command returning the same run and a conflicting one refused; a run stored by the previous release finishing after the upgrade. That last test found an upgrade bug (previous-release envelopes lacked `context`), now fixed.
- The 20 existing engine tests and 6 end-to-end crash tests pass through the new path, the end-to-end tests now driving `project add`, `workflow create`, `workflow publish` and `run start` through the CLI.
- The queue adoption probe ran against Queuert 0.16.0; results and the decision are in the decision log.

Checks and results: `pnpm check` passed formatting, protocol drift, both type checks, the app build and 95 tests (86 server, 9 app) with zero failures or skips. `pnpm --filter @shift/server test:opencode` could not be run meaningfully: the owner's `opencode-go` API key has expired, and OpenCode reports `provider.auth` ("This API key has expired") on every model call, so 9 of its 10 subtests failed before any Shift behavior was exercised. It must be rerun with a valid key. The failure showed a gap: a provider authentication error ends the turn as an ordinary failure, so Shift spends its correction prompts and reports `RESULT_MISSING` instead of the provider error. Classifying provider errors as non-correctable is a follow-up.

Limitations: no `workflow_nodes`/`workflow_connections` projections; Transform has templates but no arithmetic or array operations; `maxActiveMs` is not enforced; runs still work in the project checkout; `NEEDS_HUMAN` has no repair commands.

## OpenCode on the owner's install

Status: complete. Date: 2026-10-17. Scope: the owner's direction that Shift use the current OpenCode install with its settings, as T3 Code does.

Changed files: the OpenCode namespace module (host environment, storage namespace), the runtime supervisor, systemd containment, server configuration and CLI (`--opencode-environment host|isolated`, default `host`), the adapter's storage namespace, unit, supervisor, configuration and end-to-end tests, the real-OpenCode tests and their shared setup, the server README, specification section 11.2, the capability findings and the decision log.

Acceptance coverage:

- A supervisor test starts the runtime in host mode and checks the inherited environment, withheld `SHIFT_*` and password variables, the single injected plugin with its token, no namespace config or credentials written, the storage namespace, and that the token is absent from the process command line.
- A unit test covers merging into an existing inline config. A server test refuses `SHIFT_OPENCODE_API_KEY` without isolated mode and an unknown environment value.
- End-to-end tests pin the isolated mode, because the scripted stand-in keeps its state in the namespace.
- `pnpm check` passed 97 tests (88 server, 9 app) with zero skips. `pnpm --filter @shift/server test:opencode` passed 10 of 10 in host mode with `openai/gpt-6-luna` over the owner's OpenAI OAuth connector. This also completes the real-OpenCode verification of the definitions PR, which the expired opencode-go key had blocked.

## Provider failures are reported as such

Status: complete. Date: 2026-10-18. Scope: the follow-up found when the expired opencode-go key made Shift spend its corrections and report `RESULT_MISSING`.

Changed files: the harness contract (`HarnessFailure` on ended observations), the OpenCode classifier, AgentService's turn handling and correction decision, classifier, engine and real-OpenCode tests, the capability findings, specification section 6.5 and the decision log.

Acceptance coverage:

- Classifier tests use the transcript recorded from OpenCode v2.0.26 with a refused key: `PROVIDER_AUTH` with type and status but none of the provider's text; other provider types; a failure before any step; an unsafe error type; and no cause on a successful turn.
- An engine test fails the node with `PROVIDER_AUTH`, category `external`, after one invocation and no correction prompt.
- A real-OpenCode test registers a refused key in an isolated namespace and observes `PROVIDER_AUTH`. It makes no billable model call.
- `pnpm check` passed 99 tests (90 server, 9 app) with zero skips. `pnpm --filter @shift/server test:opencode` passed 11 of 11 in host mode with `openai/gpt-6-luna`.

## Run workspaces

Status: complete for M08 as scoped with the owner (one workspace per run, no cross-run reuse, branches or fetching). Date: 2026-10-18.

Changed files: migration 0003 and its journal entry; `apps/server/src/workspaces` (workspace allocation, creation, removal and the removal command); the run engine (asynchronous admission with the base commit, workspace allocation), AgentService (worktree creation before session binding), the run repository's snapshot, agent configuration and run view; administrative routes and `shift workspace list|show|remove`; engine, workspace, storage, end-to-end and real-OpenCode tests; the server and root READMEs; and the decision log.

Acceptance coverage:

- Two runs work in separate detached worktrees at the commit admitted with each. A commit made between them reaches only the second. The project checkout, its branch and status are unchanged after agents edited tracked and untracked files.
- Worktree creation that fails after admission fails the node with `WORKSPACE_UNAVAILABLE` and sends no prompt.
- Crash recovery: a partial unregistered directory, and a completed `git worktree add` whose `READY` transition never committed (with a stray edit), are both discarded and recreated cleanly. A ready workspace deleted outside Shift is reported, not recreated.
- Removal refuses a workspace owned by a run in `NEEDS_HUMAN`, keeps a dirty worktree unless forced, unregisters it, and is idempotent. Unknown and option-like base refs are refused.
- End-to-end: `shift workspace list` and `remove` on a completed run. Removal through the CLI is refused for a run that waits in `NEEDS_HUMAN` after a crash.
- `pnpm check` passed 106 tests (97 server, 9 app) with zero skips. `pnpm --filter @shift/server test:opencode` passed 12 of 12 in host mode with `openai/gpt-6-luna`, including a real agent that edited `notes.txt` in its worktree while the checkout stayed clean.

## Owner run controls

Status: complete for the first half of M04b. Automatic retries with backoff remain. Date: 2026-10-18.

Changed files: migration 0004 and its journal entry; the run repository (control commands, completion without a live claim, limit extensions, attempt numbering, cancellation settlement and recovery, run view `cancelRequested` and `controls`), the engine (`controlRun`, background cancellation, restart recovery), AgentService (harness cancellation, the retry prompt and invocation link), the retry prompt, administrative routes, `shift run cancel|retry|fail|complete|extend`, engine, storage and end-to-end tests, the API reference and workflow guide, the prompts status, and the decision log.

Acceptance coverage:

- **Retry:** an agent step stopped with `HARNESS_OUTCOME_UNKNOWN` is retried in the same session with the unknown-effects prompt and completes. Attempts are numbered 1 (`INTERRUPTED`) and 2 (`COMPLETED`), the uncertain invocation stays `UNKNOWN`, and the repeated command is answered from its receipt.
- **Fail:** a stuck step fails with `ABANDONED` through an `error` connection, and without one fails the run, sending no prompt.
- **Complete:** a result that breaks the result schema is refused and changes nothing. A valid one completes the run, keeps the session reference, and is recorded in `controls`.
- **Extend:** a self-loop stopped at its node limit of 2 is extended by 3 and stops again at 5. The recorded extension is `{scope: node, from: 2, to: 5}`.
- **Cancel:**
  - A running agent is stopped through the harness. The run becomes `CANCELLED` with its reason, and its workspace is released.
  - An unconfirmed stop waits in `NEEDS_HUMAN` and accepts only a second cancel.
  - A cancellation interrupted by a restart finishes on the next start.
  - A turn that finishes during cancellation does not schedule a successor.
- **State and input checks:** every command is refused on a finished run, on an unknown run, and with an invalid body.
- **End-to-end:**
  - `shift run cancel --wait` on a run with a long tool call ends `CANCELLED`, and the tool process dies.
  - `shift run complete --file` resolves a run left in `NEEDS_HUMAN` by a crash.
- **Totals:** `pnpm check` passed 116 tests (107 server, 9 app) with zero skips. `pnpm --filter @shift/server test:opencode` passed 12 of 12 in host mode with `openai/gpt-6-luna`.

CI follow-up, 2026-10-18: one of the two server runs on the rebased commit failed in "a runtime that cannot start fails cleanly and leaves no scope". The failed start's scope was still listed right after it was killed. `SystemdScopes.kill` returned once the scope had no processes, but systemd keeps an emptied scope `active` until it handles the cgroup-empty notification. `kill` now also waits, within the same deadline, until the unit reports `inactive`, `failed` or unloaded. The containment guarantee (no processes remain) is unchanged; the next listing just agrees with it. Five consecutive supervisor runs passed.

## Automatic retries

Status: complete for the retry half of M04b. The active-time budget remains. Date: 2026-10-24.

Changed files: migration 0005 (`wakeups`) and its journal entry; the run repository (retry disposition on execution errors, retry scheduling inside the completing transaction, wake-up firing, cancellation of pending wake-ups, the run view's `wait` and per-execution `attempts`, the previous-attempt lookup); the engine (wake-ups fired on every pump, one timer for the earliest due row); AgentService (which failures are safe to retry, the retry prompt naming the error); the workflow validator (retries accepted, delays capped at 24 hours and ordered); `run show --wait` through a backoff; the fake OpenCode agent's `[fake-provider-error N]`; engine, workflow, storage and end-to-end tests; the workflow guide, API reference, prompts status and decision log.

Acceptance coverage:

- **Retry:** a provider error waits in `WAITING` with `wait: {kind: retry, attempt: 2, dueAt}` inside the jittered window, sends nothing until the wake-up is due, then retries in the same session with a prompt naming `PROVIDER_ERROR` and the frozen goal. Attempts read `FAILED (PROVIDER_ERROR)`, `COMPLETED`.
- **Exhaustion:** three provider errors with `maxAttempts: 3` fail the run with the last error after exactly three turns.
- **Never retried:** `PROVIDER_AUTH` fails after one attempt even with retries allowed. Unknown outcomes still wait in `NEEDS_HUMAN` (existing test).
- **Harness start failure:** a session that cannot be created is retried, and the next attempt sends the plain goal because nothing was prompted before.
- **Restart:** a server stopped during a 60-second backoff and restarted after the due time retries once at startup; one wake-up row ends `FIRED` and exactly two turns exist.
- **Cancel:** cancelling during a backoff ends `CANCELLED` at once, owner `retry` is refused while waiting, the wake-up ends `CANCELLED`, and advancing past its due time sends nothing.
- **End-to-end:** `shift run show --wait` follows a real server through two provider errors (HTTP 503 from the fake agent) and returns the completed run with three attempts and three prompts in one session.
- **Totals:** `pnpm check` passed 123 tests (114 server, 9 app) with zero skips. `pnpm --filter @shift/server test:opencode` passed 12 of 12 in host mode with `openai/gpt-6-luna`.

## Active execution time

Status: complete for the active-time budget of M04b. Reopening a `FAILED` run with an explicit retry remains open. Date: 2026-10-24.

Changed files: migration 0006 (`runs.active_ms`, `node_attempts.checkpoint_at`) and its journal entry; the run repository (charging at every attempt transition, checkpoints, recovery charges with their event, the limit before scheduling, settling a stopped over-budget attempt, `extend` with `activeMs`, `activeTime` in the run view); the engine (checkpoints on its interval, shared stopping for cancellation and the budget, `extend` validation); `shift run extend --active-minutes`; engine and end-to-end tests; the workflow guide, API reference, prompts status and decision log.

Acceptance coverage:

- **Accounting:** a run with a 5-second failed turn, a 60-second retry backoff and a 3-second successful turn has used exactly 8 seconds.
- **Between steps:** a 6-second turn under a 5-second budget stops the run in `NEEDS_HUMAN` with `ACTIVE_TIME_LIMIT` before the end node. `extend` with `executions` is refused. `extend` with 60 seconds sets the limit to 66 seconds (`{scope: active, from: 5000, to: 66000}`) and completes the run.
- **During a turn:** a turn still running after the budget is stopped through the harness (invocation `INTERRUPTED`). The run waits in `NEEDS_HUMAN`, and after `extend` a second attempt in the same session completes. Attempts read `INTERRUPTED`, `COMPLETED`.
- **Recovery:** an attempt left running across a 2-minute outage is charged 120 seconds at restart, with one `run.active_time_charged` event that explains it.
- **End-to-end:** with a 3-second budget, the fake agent's 8-second tool is stopped and dies. `shift run extend --active-minutes 1` continues the run to `COMPLETED`, and both attempts are charged.
- **Totals:** `pnpm check` passed 128 tests (119 server, 9 app) with zero skips. `pnpm --filter @shift/server test:opencode` passed 12 of 12 in host mode with `openai/gpt-6-luna`.

## Wait nodes

Status: complete for the timer half of M04c. Human input and approval are next. Date: 2026-10-24.

Changed files: the `wait` node type and its publish checks (`durationMs` or `until`, offsets required, bindings declared); the engine (deadline frozen when preparing, pass-through when due, waiting otherwise); the run repository (`startWait`, timer firing that completes and routes in one transaction, cancellation of waiting attempts, `wait` for timers in the run view); `run show --wait` through a timer; engine, workflow and end-to-end tests; the workflow guide, API reference, prompts status and decision log. The active-time end-to-end test from the previous change gets a 6-second budget, because a slow OpenCode start under full-suite load used up its 3 seconds before the tool began.

Acceptance coverage:

- **Fake clock:** a 60-second wait stays `WAITING` at 59.999 seconds and completes at 60 seconds with its input passed through. One `execution.completed` event, one `FIRED` timer, no active time.
- **Restart:** a 1-hour wait whose deadline passed while the server was down completes once on the next start.
- **Deadlines:** a past `until` passes at once without a wake-up. An `until` from a trigger binding with a `+02:00` offset resolves to the right UTC instant. An unparseable bound value fails the run with `INVALID_DEADLINE`.
- **Cancel:** cancelling a waiting run marks the attempt and the timer `CANCELLED`, and the run stays cancelled past the deadline.
- **Publish:** a wait with neither setting, with a local time, or with an undeclared binding is refused.
- **End-to-end:** `shift run show --wait` returns a run completed by a real server's 1.5-second wait.
- **Totals:** `pnpm check` passed 133 tests (124 server, 9 app) with zero skips. The active-time end-to-end test passed 3 more runs in a row. `pnpm --filter @shift/server test:opencode` passed 12 of 12 in host mode with `openai/gpt-6-luna`.

## Human input and approval

Status: complete for M04c as scoped with the owner. Held runs accepting a response wait for manual intervention, and the client attention inbox for M06. Date: 2026-10-24.

Changed files:

- **Storage:** migration 0007 (`human_interactions`, `human_responses`) and its journal entry.
- **Nodes and forms:** the restricted form dialect and its freezing (`workflows/forms.ts`), and the `human_input` and `approval` node types, with configuration-dependent ports and publish checks for forms, outcomes and template bindings.
- **Engine:** the request is frozen when the step is prepared, and the interaction starts from there. The `respond` command was added.
- **Run repository:** starting, answering and expiring interactions, retiring them on cancel, the run's `human` wait, and the interaction views.
- **Interfaces:** administrative routes and `shift interaction list|show|respond`.
- **Tests and docs:** engine, workflow, storage and end-to-end tests, the workflow guide, API reference, prompts status and decision log.

Acceptance coverage:

- **Approval:**
  - The run waits with `wait.kind: human`, and the title and instructions are rendered from a trigger binding.
  - Republishing the workflow with another title leaves the pending request unchanged.
  - Wrong outcomes, a mistyped field, an undeclared field and a stale revision are each refused without changing anything.
  - The first response completes the run with `{input, decision, response}` on the `approved` port.
  - Repeating its command returns the same interaction, and a different answer is a conflict.
  - The run used no active time.
- **Human input:** a response that breaks the form, or that carries a decision, is refused. A valid one publishes `{input, response}` and cancels the deadline.
- **Deadlines:** with a `timeout` connection, an expired request takes it. Without one, the run fails with `INTERACTION_EXPIRED` (`blocked`). Responding to an expired request returns `INTERACTION_RETIRED`.
- **Races:** a deadline falling due after a response changes nothing. Cancelling retires the request, refuses later responses as cancelled, and the attempt ends `CANCELLED`.
- **Restart:** a pending approval survives a restart, a rejection routes to its failed end with the decision in the outcome, and exactly one `interaction.responded` event exists.
- **Publish:** unsupported form keywords and formats, an outcome named `timeout`, a connection from a missing outcome and an undeclared title binding are refused. An approval with custom outcomes, a timeout route and every form widget validates.
- **End-to-end CLI:** start, draft, then review. A `rejected` answer with a comment file loops back to draft and asks again. The server restarts while the second request is pending. `interaction respond --decision approved --wait` completes the run with executions start, draft, review, draft, review, end. Repeating that command returns the stored response, and a conflicting answer exits with `INTERACTION_CONFLICT`.
- **Totals:** `pnpm check` passed 141 tests (132 server, 9 app) with zero skips. `pnpm --filter @shift/server test:opencode` passed 12 of 12 in host mode with `openai/gpt-6-luna`.

## Condition and Switch

Status: complete for the branching half of prompt 06. Execution selectors, provenance and paginated history are next. Date: 2026-10-24.

Changed files: the rule dialect and evaluator (`workflows/rules.ts`); the `condition` and `switch` node types with case ports and publish checks; inline execution in the engine; engine and workflow tests; the workflow guide, API reference and decision log.

Acceptance coverage:

- **Converging branches:** a condition (`exists` and `gt` in an `all` group) sends 7 through `big` and 2 through `small`. Both reach the same end through the chosen branch only, and the condition's output is its input.
- **First match:** a switch with `high` (`n > 9`), `mid` (`n > 4`) and `tagged` (`contains`) picks `high` for 12 even though `mid` also holds. It picks `mid` for 7 even when tagged, `tagged` for a tagged 1, and `default` otherwise.
- **Types:** comparing `"seven"` with a number fails the run with `CONDITION_TYPE`.
- **Loop across a restart:** agent, condition and a 60-second wait loop until the agent reports 3. The server restarts during the first pause. The run records three agent executions with outputs 1, 2 and 3, the condition's `true`, `true` and `false` ports, and completes once.
- **Publish:** undeclared rule bindings, a missing right operand, groups nested 5 deep, a case named `default`, duplicate case ports and a connection from a missing case port are refused.
- **Totals:** `pnpm check` passed 145 tests (136 server, 9 app) with zero skips. `pnpm --filter @shift/server test:opencode` passed 12 of 12 in host mode with `openai/gpt-6-luna`.

## Execution selectors, provenance and history

Status: complete; prompt 06 is done. Date: 2026-10-24.

Changed files: binding resolution (`sequence` and `executionId` selectors, provenance), migration 0008 and its journal entry, the execution context's predecessor, frozen sources in the run repository, the shared execution view with `predecessorId`, `connectionId` and `sources`, the paged executions route and `shift run executions`, engine, workflow and end-to-end tests, the workflow guide, API reference, prompts status and decision log.

Acceptance coverage:

- **Skipped producer in a loop:** an agent loop with three passes records 13 executions. A condition sends passes 1 and 2 through `mark` and lets pass 3 skip it. The report reads `mark` latest as 2, `mark` first as 1, and agent `{sequence: 6}` as 2.
- **Provenance across a restart:** after the server restarts, the report's sources name executions 8, 4 and 6 with their IDs and paths, its predecessor is execution 12 via `c7`, and execution 12's input source is execution 11.
- **Pages:** `after 0, limit 5` returns sequences 1 to 5 with `next: 5`. `after 10` returns 11 to 13 with `next: null`. Entries match the run view, and an unknown run returns `RUN_NOT_FOUND`.
- **Rejected selectors:** a failed execution (required or optional), a later sequence and a foreign execution ID all fail the run with `BINDING_UNAVAILABLE`. A missing `latest` value of the same optional binding uses its fallback, recorded with `fallback: true`.
- **Publish:** `{sequence: 0}` is refused.
- **End-to-end:** `shift run executions --limit 1` returns the trigger with `next: 1`, `--after 1` returns the rest with `next: null`, and `--limit 0` is refused with `INVALID_REQUEST`.
- **Totals:** `pnpm check` passed 147 tests (138 server, 9 app) with zero skips. `pnpm --filter @shift/server test:opencode` passed 12 of 12 in host mode with `openai/gpt-6-luna`.

## Device pairing and authentication

Status: complete for the pairing part of M05's server half (prompt 10). The device API for runs and events are next. Date: 2026-10-24.

Changed files: the `@scure/bip39` dependency (wordlist only); the master-key secret box (`secrets/secret-box.ts`); the device registry and service (`devices/`); migration 0009 (`pairing_challenges`, `devices`) and its journal entry; device receipt actors; the shared protocol schema, fixtures and generated validators for both apps; pairing and device routes on TCP and the administrative socket; `shift device pair|list|revoke`; server startup (key, registry, sweep); device, server and storage tests; the API reference, server README, CLI help, prompts status and decision log.

Acceptance coverage:

- **Pairing:** a phrase of eight lowercase words pairs one device. Typing it in upper case with hyphens still works. The token authenticates its device.
- **Lost response:** the same command and body return the same device and token until 1 ms before the phrase's expiry. Another command ID is refused, and a changed body is `COMMAND_CONFLICT`. At expiry the delivery copy is erased, while the device keeps working until it is revoked.
- **No plain text:** after a checkpoint, the database file contains neither the phrase nor the token. The server's stdout and stderr contain neither, end to end.
- **Guessing:** expired phrases are refused. 20 failures from different addresses withdraw the open phrase. An eleventh attempt per address within a minute is `429 RATE_LIMITED` (retryable), and it passes again after a minute.
- **Revocation:** a repeated command returns its receipt, a second revocation changes nothing, and listeners are told once, after the commit. The token then fails, and unknown devices and extra fields are refused.
- **Master key:** created with mode 0600 and reopened with the same key. A wrong context or tampered ciphertext fails, mode 0644 is refused, and a file whose current key is missing is invalid.
- **End-to-end:** info advertises pairing. `shift device pair` prints the phrase, `POST /api/v0/pair` returns a validated `PairResponse`, and a repeat returns the same token. Without a token the device list is `401` with `WWW-Authenticate: Bearer`; with it, the list is validated. A device can issue a new phrase. After `shift device revoke`, the token gets `401`.
- **Totals:** `pnpm check` passed 153 tests (144 server, 9 app) with zero skips. `pnpm --filter @shift/server test:opencode` passed 12 of 12 in host mode with `openai/gpt-6-luna`.

## Device API

Status: complete for the device API part of M05's server half (prompt 10). Events are next. Date: 2026-10-24.

Changed files: one resource router for both listeners in `http.ts`; actor parameters in the definition, workspace and run services; receipt lookup and the replay marker in `persistence/receipts.ts`; the shared protocol schema, fixtures and generated validators for both apps; server wiring of the engine and services into TCP; device API, server and protocol type tests; the API reference, server README, prompts status and decision log.

Acceptance coverage:

- **End-to-end over TCP:** two paired devices. A mutation without a command ID is refused. With command IDs, the laptop registers a project, creates and publishes an approval workflow, and starts a run. All responses are validated by the server and again by the test.
- **Lost acknowledgement:** a stale revision is refused first. The laptop's answer is then sent and its response ignored. `GET /commands/respond-1` returns the stored `RESPONDED` interaction, recorded with the laptop as actor. Resending the identical command returns the same interaction, and a changed body is `COMMAND_CONFLICT`. The desktop's later answer is `INTERACTION_CONFLICT`. The desktop cannot see the laptop's receipt (`COMMAND_NOT_FOUND`). The run completed through the approval exactly once.
- **Access:** no token is `401` on `/runs`, and `/api/v0/admin/runs` over TCP is `404`. The CLI on the socket still works alongside.
- **Schemas against real output:** every existing engine, CLI and end-to-end test now goes through validated responses on the socket.
- **Totals:** `pnpm check` passed 154 tests (145 server, 9 app) with zero skips. `pnpm --filter @shift/server test:opencode` passed 12 of 12 in host mode with `openai/gpt-6-luna`.

## Event snapshot, replay and stream

Status: complete; M05's server half (prompt 10) is done. The client half (prompt 11) remains. Date: 2026-10-25.

Changed files: the event log and SSE streams (`events/`); snapshot, history and stream routes on both listeners; stream closing on revocation and shutdown; `--event-keepalive-ms`; the shared protocol schema, fixtures and generated validators for both apps; `shift event list`; event, device API, server and protocol type tests; the API reference, server README, prompts status and decision log.

Acceptance coverage:

- **Cursors:** these all get `RESYNC_REQUIRED`: a missing cursor, an empty one, a malformed one, one with a leading zero, one from another epoch, and one past the newest event. Pages split at `limit` with `next` and `highWater`. A snapshot carries the newest cursor.
- **Snapshot and live race:** twenty phrases are issued while the device takes a snapshot and opens the stream, and one more after that. Every event after the snapshot's cursor arrives once, in order, with no gap; at least 21 arrive. Each SSE `id` equals its event's cursor, and every event validates.
- **Reconnect:** from a cursor in the middle, only the later events are replayed.
- **Keepalive and headers:** an idle stream sends keepalive comments. Responses are `text/event-stream` with `no-store, no-transform` and `X-Accel-Buffering: no`.
- **Slow client:** a client that never reads is closed once its pending output passes the bound, and the stream is removed.
- **Revocation:** revoking the device closes its open stream, and reconnecting with the token is `401`. The token never appears in server output.
- **Proxy:** behind a streaming reverse proxy that drops connections after one second idle, keepalives hold the stream for 2.5 s, and a new event arrives within 1.5 s.
- **Aborted client:** aborting a device's stream leaves its waiting approval run `WAITING`.
- **Totals:** `pnpm check` passed 158 tests (149 server, 9 app) with zero skips. `pnpm --filter @shift/server test:opencode` passed 12 of 12 in host mode with `openai/gpt-6-luna`. One of nine repeated runs of the event tests failed right after the OpenCode suite, without output kept, and later runs did not reproduce it. The slow-client test's 500 ms close window was the likeliest cause and now waits up to 10 s. Thirteen further runs passed.

## Client pairing and credentials

Status: complete for the pairing and credential part of M05's client half (prompt 11). The sync runtime is next. No renderer change, as the owner asked. Date: 2026-10-25.

Changed files:

- **client-core:** URL rules (`url.ts`), the HTTP exchange (`http.ts`), credential and profile interfaces with memory stores (`credentials.ts`), and the connection runtime (`connection.ts`). Status queries go through the connection (`runtime.ts`).
- **main:** `safeStorage` credential and profile file adapters (`storage.ts`), connection IPC requests in the dispatcher, the main composition, and the smoke checks.
- **preload and contracts:** the narrow `connection` bridge, and the IPC connection view and request schemas.
- **Protocol:** the shared `ProtocolRange` schema now accepts any non-negative integers.
- **Tests and docs:** client tests, the app README, the prompts status and the decision log.

Acceptance coverage (fake `fetch` server from the shared fixtures):

- **URLs:** HTTPS, trailing slashes and spaces are normalized. Remote HTTP, loopback HTTP outside development, user info, queries, other schemes and non-URLs are all refused.
- **Pairing:** a paired profile goes online and holds the token only behind its handle. The state, public profiles and the stored profile file contain neither token nor phrase. The token is first sent on the device check, after info.
- **Lost response:** a dropped pairing response leaves the pairing pending. Pairing again, even with the phrase typed in upper case, repeats the same command ID and creates one profile. A different phrase gets a new command ID. Abandoning clears it.
- **Told apart:**
  - A retry that reaches another server is `IDENTITY_MISMATCH`.
  - A refused phrase is cleared as `PAIRING_REJECTED`.
  - A rate limit stays pending.
  - A server with only protocol 1 is `PROTOCOL_UNSUPPORTED`, while one with 0 to 1 pairs.
  - No pairing capability is `PAIRING_UNAVAILABLE`.
  - Remote HTTP is `INSECURE_URL`.
- **Restart:** the saved credential reconnects. A session-only store loses it, which leads to `CREDENTIAL_MISSING`, and the profile shows `missing`.
- **Failures:** an unreachable server leaves the profile `offline`. An impostor at the saved address is `incompatible` and never receives a token. A `401` device check is `revoked` and deletes the token.
- **Address change:** kept only when the same server ID answers.
- **Clear:** deletes the credential and profile, supersedes a connection still in flight, and sends nothing.
- **Status queries:** sent with the device token. Info from another server is refused.
- **Electron smoke** (built app, Linux under Xvfb): the bridge exposes exactly the connection methods. With no saved connection the state is `unconfigured`. Remote HTTP is refused, a path-like profile ID is an invalid request, and no credential field reaches the renderer. With the `basic_text` backend, credential storage is `session`.
- **Totals:** `pnpm check` passed 163 tests (149 server, 14 app) with zero skips.

## Client sync runtime

Status: complete for the sync part of M05's client half, which completes prompt 11. No renderer change. Date: 2026-10-28.

Changed files:

- **client-core:** the sync supervisor, event application, receipts and commands (`sync.ts`); the cache types and memory store (`projection.ts`); the SSE request in `http.ts`; and identities from `authenticated()` in `connection.ts`. `ClientCore` owns a `SyncRuntime`.
- **main:** the per-profile cache file (`FileSyncStore` in `storage.ts`), starting sync at launch, `sync.read` in the dispatcher, forgetting the cache when a profile is cleared, and the smoke checks.
- **preload and contracts:** the `sync.read` bridge method and the sync view schema.
- **Dependency:** eventsource-parser 4.1.3, bundled into main.
- **Tests and docs:** `test/sync.test.ts`, `test/sync-live.test.ts`, a boundary check, the app README, the prompts status and the decision log.

Acceptance coverage, against a scripted fake server with manual timers:

- **Snapshot and events:** a snapshot goes live. Each event refetches the run it names, and the cache and cursor are saved together. New runs are added and deleted runs removed. Device and pairing events fetch nothing.
- **Duplicates and order:** a repeated event, an older one and one below the cursor are applied once, with one fetch.
- **Lost after commit:** the server applies an approval, then the answer and the network are lost. The command is `unknown`, reconnects back off, and the receipt confirms `accepted` with no second POST. The cached form becomes `RESPONDED`.
- **Never arrived:** a dropped POST is `not_applied` from its receipt. `resend` repeats the same command ID. A conflict with another device's answer is `rejected` with `INTERACTION_CONFLICT`. A send while not live is refused.
- **Epochs and resync:**
  - A restored database (new epoch) takes a new snapshot and updates the profile's epoch.
  - A refused cursor takes a snapshot.
  - An unknown event type (including a new type in a known family) or version takes a snapshot.
- **Stale and replaced:**
  - A slow refresh answering with older state cannot overwrite a newer one.
  - After `disconnect`, a held fetch lands without changing the cache or the saved cursor, and the stream is closed.
- **Keepalive:** traffic re-arms the timer. Silence past the timeout reconnects from the saved cursor without a snapshot.
- **Backoff:** 100, 200, 400, 800, 800, 800 ms with the test cap, a stream that opens and drops without traffic keeps the 800 ms wait, and one that carried a keepalive goes back to 100 ms.
- **Revocation:** the device ends up `revoked`, sync stops, the cache and token are deleted, and nothing retries.
- **Restart:** a new runtime with the saved stores catches up 1,201 events in three pages, without a snapshot.
- **Live** (real server, Linux): two paired clients, a lost approval acknowledgement across a server restart, a single POST confirmed by its receipt, convergence on both devices, a refused late answer, and a restart from the saved cursor.
- **Electron smoke** (Linux, Xvfb): the bridge adds exactly `sync.read`, and sync is `stopped` with no cache when nothing is connected.

## Canvas shell (12a)

Status: the first of two parts of prompt 12 (M06). The canvas is view-only; editing is prompt 13. Date: 2026-10-28.

Changed files:

- **Product and design context:** `PRODUCT.md` (users, purpose, personality, anti-references, principles, WCAG 2.2 AA) and a seed `DESIGN.md` at the repository root.
- **Server:** `GET /workflows/{id}/versions/{versionId}` and the `WorkflowVersionResponse` schema, fixture and generated validators; the API reference.
- **client-core:** `SyncRuntime.query` for live reads, and resource reads with a last-copy cache and run commands in `ClientCore`.
- **main and preload:** data and run IPC requests, resource validation, change notifications, the frameless window, capture mode and the smoke checks.
- **Renderer:** pairing, the canvas, node cards, the location island with the switcher and runs menu, the run status island, the status chip and attention count, the connection banner, the inspector, the list view, the toolbar, the run input island, empty-state hints and the stylesheet with both themes.
- **Tools and tests:** `tools/capture.mjs`, `tools/stage.mjs`, `test/graph.test.ts`, boundary checks and a stale-read test.

Verification:

- **Graph model:** lenient reading of invalid drafts, ports for every node type including switch cases and approval outcomes, the server's default row laid out again while saved positions are kept, per-node run state with loop passes, followed connections, wait and attention reasons, and route round-trips that reject anything but identifiers.
- **Boundaries:** path-like or extra-field data requests are refused; reads and runs without a connection are `DISCONNECTED`; resource answers are bounded in size and depth.
- **Stale reads:** a run read live is returned marked stale, unchanged, after the connection drops; an unknown one is `NOT_FOUND`.
- **Server:** a device reads a published version's document; a version under another workflow is `404`.
- **Electron smoke** (Linux, Xvfb): the pairing step with labelled fields, no canvas before pairing, the exact bridge, disconnected resource and run requests, no overflow at 720×480.
- **Screenshots** from `tools/capture.mjs` against a real server, inspected in both themes at 1440×900 and 900×640: pairing, the draft, the draft inspector, a waiting run with completed, waiting and unreached nodes, the run inspector, the switcher, the runs menu and the list view. Fixes made after inspection: the server's default row overlapped cards, edges were hidden under them, the run status island collided with the location island, the initial zoom made cards unreadable, and on narrow windows the wrapped run status covered the side islands.

## Moving nodes

Status: drafts can be rearranged on the canvas; the rest of the editor is prompt 13. Date: 2026-10-29.

- **Changed:** `client-core/positions.ts` and `ClientCore.moveNodes`, the `workflow.move` IPC request and bridge method, dragging and arrow-key moves in the canvas, a notice island with a dismissible problem tone, the capture tool's drag step, and the device transport accepting `PUT` bodies.
- **Verified:**
  - The position merge leaves every other field of the draft untouched and rounds to whole pixels.
  - Move requests are bounded in node count, size, coordinate range and revision.
  - A device saves a draft and a stale revision is `REVISION_CONFLICT` (server test).
  - Against a real server, a real mouse drag in the built app saved the new position, which was still there after switching to a run and back; the run kept its frozen layout. The first attempt found the server bug above.
