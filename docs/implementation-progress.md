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
