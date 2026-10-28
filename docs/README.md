# Documentation

## Using Shift

- [Workflows and runs](workflows.md): the workflow document, node types, bindings, agent results, workspaces, run states and crash recovery.
- [Server API](server-api.md): the HTTP endpoints, request and response shapes, command IDs, the matching CLI commands and every error code.
- [Server README](../apps/server/README.md): building, running and configuring `shift serve`, and the OpenCode harness.
- [Example workflow](examples/count-words.json).

## Design

- [Shift Server v0](shift-server-v0.md): architecture, domain model, execution semantics, persistence, recovery and the implementation roadmap (section 18).
- [Shift Client v0](shift-client-v0.md): the Electron client, visual workflow editor and remote connection.
- [Desktop UI direction](ui-direction.md): the canvas-first layout, its islands and the visual style. It replaces the client specification's sidebar layout.

Both specifications are approved as working documents: implementation evidence can still revise them, and each revision is recorded in the decision log.

## Evidence and records

- [OpenCode capabilities](opencode-capabilities.md): what OpenCode v2 was observed to do, the rerunnable probe, and what the adapter relies on.
- [Implementation decisions](implementation-decisions.md): dependency and design decisions, with the alternatives considered.
- [Implementation progress](implementation-progress.md): what each change delivered and how it was verified.

## Planning

- [Implementation prompts](prompts/README.md): scoped tasks mapped to the roadmap milestones.

The repository has two workspaces, `apps/server` and `apps/app`.
