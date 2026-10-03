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
