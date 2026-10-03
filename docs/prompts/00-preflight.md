# 00. Review dependencies and freeze initial contracts

Read [COMMON.md](COMMON.md). Execute this task only when the owner requests it.

Prerequisites: none. Roadmap: preparation before M01.

Read both specifications, especially server sections 2-5, 9-11, 13, 15, and 18; client sections 2-4 and 7-9. Inspect the actual manifests and repository. Resolve the roadmap's expanded-package wording using the explicit two-workspace decision.

Write `docs/implementation-decisions.md` with an evidence-based dependency review. Compare maintained durable-workflow/job libraries with Shift's single-process SQLite requirement, atomic state/event/receipt/job transactions, indefinite human waits, editable graph versions, and uncertain external-effect reconciliation. Evaluate whether adoption would introduce another database/service or a competing source of execution truth. Recommend reuse where it fits; justify custom engine/store code only for requirements the available libraries cannot meet. This review is a prerequisite to building those components.

Also assess the proposed SQLite binding/migrations, schema validation, scheduling, subprocess control, SSE parsing, Electron build/credentials, React Flow, query caching, schema forms, and editor undo/redo. Separate decisions needed now from decisions to verify at the relevant prompt. Link current primary sources and record version/maintenance evidence. Check the Node/pnpm/native-binding/platform compatibility and patched SQLite requirement.

Define the initial protocol ownership and build-time consumption strategy within the existing two workspaces. Outline versioned graph/envelope/error/catalog/event schemas, command receipt identity, consistent snapshot/high-water mark, server/event identity, and fixture ownership. The app may consume pure generated protocol artifacts, but must not import server startup, executors, persistence, or native dependencies. Define who changes those contracts during parallel work.

Document assumptions to probe in 03, plus release prerequisites requiring an operator. Treat library incompatibility as evidence to discuss, not permission to change approved product behavior.

Acceptance:

- The decision document records concrete alternatives and selection reasons, including why any custom durable infrastructure is necessary.
- Server/app boundaries and protocol generation avoid extra workspaces and accidental native/secret imports.
- An agent can identify required inputs and outputs for 01, 02, and 03 without another architecture interview. Unresolved decisions are named and dependent work is identified.
