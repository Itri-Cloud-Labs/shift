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
