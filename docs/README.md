# Documentation

- [Shift Server v0](shift-server-v0.md) covers architecture, domain models, execution semantics, persistence, recovery, and the integrated implementation roadmap.
- [Shift Client v0](shift-client-v0.md) covers the Electron client, visual workflow editor, remote connection, and client implementation plan.
- [Implementation prompts](prompts/README.md) contains 33 scoped agent tasks, prerequisites, acceptance checks, and a server/client parallel-work guide.
- [Implementation decisions](implementation-decisions.md) records the preflight dependency review, initial protocol boundaries, and later verification gates.
- [Implementation progress](implementation-progress.md) records completed prompt acceptance cases and remaining checks.

Both specifications remain proposed for approval. The initial monorepo has two workspaces, `apps/server` and `apps/app`. Additional packages are deferred.
