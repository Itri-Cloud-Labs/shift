# Instructions for every implementation prompt

Read this file before executing any numbered prompt. Each prompt is one bounded task. Its prerequisites refer to completed behavior and passing checks, not merely the existence of files.

## Authority and scope

The specifications remain proposed. Creating this prompt pack authorizes documentation only. When the owner asks you to execute a prompt, use that instruction as authorization for its stated local implementation scope. Honor any unresolved owner decisions before dependent implementation; do not ask again for work already authorized in the conversation. This pack grants no authority to deploy services, publish releases, use paid model calls, modify real project repositories, or obtain signing/DNS/GitHub credentials. Use temporary repositories and fake integrations by default. Complete independent work when an external prerequisite is missing and report exactly what remains unverified.

Read the current repository instructions, the selected prompt, and its cited specification sections before editing. The [server specification](../shift-server-v0.md) owns execution/domain semantics; the [client specification](../shift-client-v0.md) owns desktop behavior. Explicit owner decisions take precedence. Record unresolved contradictions rather than inventing semantics. Preserve reasoned disagreement when a requested choice conflicts with evidence.

## Before implementation

1. Inspect the worktree, existing components, manifests, scripts, and previous milestone outputs. Preserve unrelated work. Verify the selected prompt's prerequisites through behavior/tests; implement only the selected scope.
2. Before implementing substantial infrastructure, inspect existing dependencies and evaluate maintained libraries against Shift's requirements using current official documentation and source. Reuse suitable libraries. Record the choice, rejected alternatives, versions, and any concrete reason for custom code in `docs/implementation-decisions.md`. Read prior decisions before repeating research. Evaluate workflow durability, scheduling, process control, SSE parsing, forms, and editor history when those areas are touched.
3. Keep the two application workspaces, `apps/server` and `apps/app`. Put domain, protocol, persistence, engine, harness, CLI, and integration modules inside the server; client-core, UI, main, and preload inside the app. The expanded layout and M01's package wording are future extraction guidance. Keep client protocol consumption pure and verifiable at build time; native bindings, executors, and secrets must remain outside its dependency graph.
4. Use the installed scripts and pinned toolchain. Add the smallest scripts/configuration needed for this task. Pin verified versions rather than copying version claims from the specification. Update operator/developer instructions when commands or required setup change.

## Contracts to preserve

- HTTP commands/queries and authenticated SSE are v0's transport. Execution continues with every client disconnected.
- One run has one active path. Backward edges create executions; retries create attempts; corrections create invocations. Arrays remain single values. Several incoming edges are alternative entry paths.
- Published versions and run snapshots are immutable. Draft saves and mutable controls use expected revisions. References resolve from the earlier successful predecessor chain, with explicit fallbacks for missing optional values.
- SQLite state, events, receipts, and successor scheduling commit together. External I/O runs outside short synchronous transactions. Fences reject stale completion. Durable intent precedes an external effect; uncertainty requires reconciliation before retry.
- Session strategies, lifetime, workspace ownership, and invocation ownership are explicit. Missing sessions require a recorded repair, never a silent replacement. Persistent sessions outlive nodes, runs, and idle processes.
- Agent business data drives Condition/Switch nodes. Shift constructs metadata and validates its terminal envelope independently. Reports are immutable artifacts, not execution authority.
- Server secrets stay out of snapshots, ordinary receipts, logs, renderer state, and protocol payloads. Electron main owns credentials and transport; preload exposes validated narrow operations.
- Normal workflow authoring uses forms/pickers. Advanced config and Script are explicit modes. The client derives state from server records and never runs an engine.

## Verification and handoff

Test the changed behavior with temporary real SQLite/Git storage, injected clocks, fake endpoints/harnesses, and subprocess crash tests where durability is involved. A mock-only test cannot establish crash persistence. Run appropriate build/type checks and relevant regression tests. Check all acceptance cases listed in the selected prompt. Distinguish a test fixture from a verified real adapter or packaged platform.

Finish with changed files, decisions affecting later prompts, exact checks and results, a reproducible demo command, and remaining limitations/prerequisites. Add an entry to `docs/implementation-progress.md` identifying the prompt, completed acceptance cases, and any incomplete checks. Mark a prompt complete only when its acceptance criteria pass; otherwise mark partial or blocked with evidence. Preserve prior entries. Do not create a commit, PR, deployment, or release solely because a prompt is finished.

For parallel work, use the ownership/dependency rules in [README.md](README.md). Agree on protocol changes before both sides implement them. Keep each branch buildable with deterministic fixtures until integration is available.
