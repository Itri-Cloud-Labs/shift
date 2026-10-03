# 15. Allocate retained workspaces and durable resource claims

Read [COMMON.md](COMMON.md).

Prerequisites: [09](09-human-timer-waits.md). Roadmap: server M08. Can run with 10-14. Workspace UI integration requires 14 and is completed by 16.

Read server sections 4.2, 7, 10-11 and client section 5.5. Implement workspace creation as durable effect intent plus detached Git worktree at the run's recorded base commit. Register existing host repositories as anchors; no implicit fetch changes admitted runs. Inspect maintained Git/process helpers before writing command wrappers. Worktree provisioning after a crash requires evidence-based reconciliation.

Support new/existing/session-workspace policies with same-project compatibility, one workspace per run, and retained resource records. Acquire workspace before session in a fixed order. A nonterminal run owns its workspace across human/timer/integration waits and holds. Shared targets queue durably and release worker slots. Claims carry generation/fences; expiry alone cannot establish a previous process stopped.

Release only when active processes/effects are stopped or accounted for. Explicit retries reacquire claims and validate workspace changes. Persistent session pins prevent removal; completed worktrees remain until explicit retirement. Expose resource owner/queue/base commit metadata in CLI/protocol and fixture it for the app. File browsing remains scoped/read-only, implemented fully in 27.

Acceptance:

- Concurrent runs in a temporary source repo allocate isolated directories/base commits.
- Explicit shared-workspace runs queue through waits/holds/restarts without double ownership.
- Crash during creation reconciles one recorded workspace or reports uncertainty; stale holders cannot release/advance a new claim.
- Removal refuses live/pinned workspaces, and run snapshots preserve their base commit through later anchor changes.
