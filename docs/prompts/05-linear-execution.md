# 05. Execute a durable linear graph

Read [COMMON.md](COMMON.md).

Prerequisites: [04](04-durable-definitions.md). Roadmap: M03.

Read server sections 4.2, 5, 6.1-6.2, 9-11, and 12.1. Recheck the library review before implementing engine/store infrastructure. Build the single-path engine with Manual entry, declarative Transform, and End nodes. Run admission freezes the selected version, input, and effective public configuration. Disabled workflows reject manual starts; retain explicit admission/overlap contracts for later triggers.

Implement runs, executions, attempts, cursor, durable jobs, fences, events, and CLI/system command receipts. Claim work in short transactions, execute outside them, and commit output, state, event, receipt where applicable, and successor job atomically. Executors use application contracts rather than raw database handles and cannot recursively execute successors. An entry trigger records a completed execution carrying its input envelope.

Preserve full envelope semantics, with declared Transform output and retained handoff/workspace context. Arrays produce one successor activation. Respect generic producer port restrictions and explicit End outcomes; an unconnected selected port is a successful leaf. Add basic admission/concurrency and deterministic inspection without introducing a second state machine in jobs.

Acceptance:

- CLI starts Trigger -> Transform -> End, then inspects frozen inputs/output and recorded executions/attempts after restart.
- Subprocess crashes around claim and transition commits leave either old or new durable state, with one successor and no duplicated activation.
- Duplicate callbacks/stale fences cannot advance a completed attempt again.
- Changing the draft/profile after start leaves the run unchanged. An array output invokes the successor once, and parallel runs retain separate cursors.
