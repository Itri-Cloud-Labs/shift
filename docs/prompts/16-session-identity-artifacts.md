# 16. Add session policies, fake harness execution, and artifacts

Read [COMMON.md](COMMON.md).

Prerequisites: [15](15-workspace-allocation.md). Read findings from 03 if available. Roadmap: M08a. UI integration also requires 14; the server portion can proceed independently.

Read server sections 4.3, 6.4-6.5, 9-11; client sections 5.3-5.6 and 6.2. Implement Shift sessions, adapter mappings/runtime generations, run/node session bindings, invocations, normalized entries, and a deterministic fake adapter/process owner. Allocate identities/bindings before harness conversation creation and persist provisioning intent. Keep missing/corrupt mappings observable as blockers.

Implement fresh/per_run/reference independently of persistent/ephemeral lifetime. Per-run loops reuse the configured session; attempts keep their binding. Cross-run reuse requires attaching to the same retained workspace and compatible project/configuration. One invocation owns a session; queued owners retain fixed acquisition order and release worker capacity. Session-wide cancellation cannot release ownership until stop is accounted for.

Implement content-addressed artifact ingestion with contained invocation directories, capped bytes, hash/flush/atomic rename, then durable publication. Link run/execution/attempt/invocation/session and semantic roles. Preserve default handoff/human-report filenames as display labels, with immutable bytes per invocation. Expose scoped metadata/download/history APIs and fake reports.

Integrate workspace/session pickers and resource queue/lifetime presentation after 14. Disable incompatible selections before start while retaining authoritative server checks.

Acceptance:

- Fake agents demonstrate fresh and per-run loops, retry identity, explicit cross-run reuse, retention after completion, and ephemeral archive constraints.
- Missing mappings and uncertain session creation enter reconciliation rather than create a substitute.
- Artifact crash tests yield an unreferenced blob or a valid immutable reference, never a published missing file.
- Different invocations' same-named reports stay distinct; handoffs survive non-Agent nodes, and UI selectors use Shift IDs.
