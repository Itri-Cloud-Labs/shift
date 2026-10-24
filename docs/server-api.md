# Shift server API

This is the HTTP interface of `shift serve` as implemented today: protocol version 0, under `/api/v0`. The `shift` CLI is a thin client over it, so every CLI command below maps to one request. The remote protocol for paired clients, with SSE events and device authentication ([specification section 13](shift-server-v0.md#13-pairing-api-and-events)), is not implemented yet. [Workflows and runs](workflows.md) covers the document format and execution behaviour that these endpoints operate on.

## Transports

The server listens on two transports with different reach.

| Transport             | Address                                                                                    | Serves                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| TCP                   | `127.0.0.1:4317` by default (`--host`, `--port`). A non-loopback address needs `--public`. | Read-only `GET /api/v0/info`, `/api/v0/health` and `/api/v0/ready`. Nothing else, and no request bodies. |
| Administrative socket | `<state>/admin.sock`, a Unix socket with mode `0600` inside the private state directory    | Everything on TCP, plus every `/api/v0/admin/…` route.                                                   |

The state directory defaults to `$XDG_STATE_HOME/shift`, or `~/.local/state/shift` when `XDG_STATE_HOME` is unset. Set it with `--state-dir` or `SHIFT_STATE_DIR`. Access to the socket is access control: only the account that owns the state directory can connect. The CLI also refuses to use a socket or state directory that another account could read. Requests that carry an `Origin` header are refused with `403 INVALID_REQUEST`, so a browser page cannot drive the socket through a local proxy.

Calling the socket directly:

```sh
curl --unix-socket ~/.local/state/shift/admin.sock http://shift/api/v0/admin/runs
```

The host part of the URL is ignored.

## Conventions

- **Envelope:** every JSON response has `schemaVersion: 1` and a `requestId`. The same ID is sent in the `X-Request-ID` header and appears in server logs. Resource fields sit beside these two, for example `{"schemaVersion": 1, "requestId": "…", "run": {…}}`.
- **Identifiers** are UUIDs. **Timestamps** are Unix epoch milliseconds.
- **Bodies:** administrative `POST` and `PUT` routes take a JSON body of at most 2 MiB. `GET` routes and `/api/v0/admin/shutdown` reject any body. Responses are never cached (`Cache-Control: no-store`).
- **Errors** have one shape:

  ```json
  {
    "schemaVersion": 1,
    "requestId": "c2c52188-1252-406f-8883-1e20c34f9ae5",
    "code": "INVALID_WORKFLOW",
    "message": "Invalid workflow: /nodes/0/type Unknown node type teleport version 1.; /nodes A workflow needs exactly one manual_trigger node.",
    "retryable": false,
    "diagnostics": [
      { "field": "/nodes/0/type", "message": "Invalid field." },
      { "field": "/nodes", "message": "Invalid field." }
    ]
  }
  ```

  `code` is stable and meant for programs. `message` is for people and never contains raw exception text, credentials or provider responses. `diagnostics` lists the JSON pointers of rejected fields, at most 32. The [error codes](#error-codes) section lists every code.

### Command IDs

Every request that changes state accepts an optional `commandId`: 8 to 100 characters from `A-Z a-z 0-9 _ -`. Shift stores the outcome of each command with its ID in the same transaction as the change.

- Repeating a command with the same ID and the same request returns the stored status and body. Nothing is applied again. The stored body describes the resource as it was when the command first ran, so a repeated `POST /runs` returns the run as it looked at creation. Use `GET /runs/{id}` for its current state.
- Reusing an ID for a different request fails with `409 COMMAND_CONFLICT`.
- A command that fails stores nothing, so the same ID can be retried after fixing the cause.

Without a `commandId`, a lost response cannot be told apart from a command that never ran. The CLI always sends one (`--command-id`, or a generated UUID) and retries once with the same ID when the socket connection fails.

## Endpoints

| Method and path                             | CLI                      | Purpose                                          |
| ------------------------------------------- | ------------------------ | ------------------------------------------------ |
| `GET /api/v0/info`                          | `shift info`             | Server identity, protocol range and capabilities |
| `GET /api/v0/health`                        | `shift health`           | Liveness and readiness                           |
| `GET /api/v0/ready`                         | `shift ready`            | Readiness; `503` when not ready                  |
| `POST /api/v0/admin/shutdown`               | `shift stop`             | Graceful shutdown                                |
| `POST /api/v0/admin/projects`               | `shift project add`      | Register a repository                            |
| `GET /api/v0/admin/projects`                | `shift project list`     | List projects                                    |
| `POST /api/v0/admin/workflows`              | `shift workflow create`  | Create a workflow with a draft                   |
| `GET /api/v0/admin/workflows[?projectId=]`  | `shift workflow list`    | List workflows                                   |
| `GET /api/v0/admin/workflows/{id}`          | `shift workflow show`    | Workflow with its draft and versions             |
| `PUT /api/v0/admin/workflows/{id}/draft`    | `shift workflow save`    | Replace the draft at an expected revision        |
| `POST /api/v0/admin/workflows/{id}/publish` | `shift workflow publish` | Publish the draft as a version                   |
| `POST /api/v0/admin/runs`                   | `shift run start`        | Start a run of the active version                |
| `GET /api/v0/admin/runs`                    | `shift run list`         | List runs                                        |
| `GET /api/v0/admin/runs/{id}`               | `shift run show`         | Run with executions and invocations              |
| `POST /api/v0/admin/runs/{id}/cancel`       | `shift run cancel`       | Cancel a run                                     |
| `POST /api/v0/admin/runs/{id}/retry`        | `shift run retry`        | Retry a stuck step                               |
| `POST /api/v0/admin/runs/{id}/fail`         | `shift run fail`         | Abandon a stuck step                             |
| `POST /api/v0/admin/runs/{id}/complete`     | `shift run complete`     | Record a verified result for a stuck step        |
| `POST /api/v0/admin/runs/{id}/extend`       | `shift run extend`       | Raise the limit a run reached                    |
| `GET /api/v0/admin/workspaces[?projectId=]` | `shift workspace list`   | List run workspaces                              |
| `GET /api/v0/admin/workspaces/{id}`         | `shift workspace show`   | One workspace                                    |
| `POST /api/v0/admin/workspaces/{id}/remove` | `shift workspace remove` | Remove a finished run's worktree                 |

The CLI prints the resource from each response as one JSON line: the `project`, `workflow`, `run`, or list, without the envelope. On failure it prints the error object to stderr and exits with status 1.

### Server status

`GET /api/v0/info`

```json
{
  "schemaVersion": 1,
  "requestId": "f44c0c24-ad6d-4fa9-90c8-fe57cbeae8ac",
  "serverId": "068e1aa4-bf23-4237-8e18-3cc7a5a2e0da",
  "eventEpoch": "ed796564-a0a8-4dbb-881d-6b6fe5f680bb",
  "serverVersion": "0.0.0",
  "protocol": { "min": 0, "max": 0 },
  "readiness": { "ready": true, "phase": "ready", "reason": "READY" },
  "time": { "epochMs": 1792285993924, "iso": "2026-10-18T01:13:13.924Z" },
  "capabilities": {
    "commands": false,
    "events": false,
    "pairing": false,
    "nodeTypes": [],
    "harnesses": []
  }
}
```

`serverId` identifies this state directory and survives restarts. `eventEpoch` changes when event history is reset. `capabilities` describes the remote protocol, which is not available yet, so every flag is off.

`GET /api/v0/health` returns the same identity with `liveness: "alive"` and `readiness`, always with status `200` while the process answers. `GET /api/v0/ready` returns the same body with status `503` unless `readiness.ready` is true. `phase` is `starting` until the database is open and migrated, `ready`, `stopping` during shutdown, or `failed` after a persistence failure (`reason: PERSISTENCE_UNAVAILABLE`).

`POST /api/v0/admin/shutdown` takes no body and answers `202 {"accepted": true}`. The server then stops within its shutdown deadline (`--shutdown-timeout-ms`). Running agent turns are cancelled through the harness so the next start can continue them.

### Projects

A project is an existing Git repository on this host, registered by its top-level directory.

`POST /api/v0/admin/projects`

| Field       | Type             | Notes                                                                                                          |
| ----------- | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `path`      | string, required | Absolute path to the repository's top level. Symlinks are resolved. A subdirectory is refused.                 |
| `name`      | string           | Defaults to the directory name.                                                                                |
| `baseRef`   | string           | The ref runs start from. Defaults to the current branch, or `HEAD` when detached. It must resolve to a commit. |
| `commandId` | string           | See [command IDs](#command-ids).                                                                               |

```json
{
  "schemaVersion": 1,
  "requestId": "d5090d68-adb2-4452-a6f9-b017e6d85106",
  "project": {
    "id": "03379958-7041-4506-8d6c-abc0c8691561",
    "name": "repo",
    "repositoryPath": "/tmp/apidoc/repo",
    "baseRef": "main",
    "createdAt": 1792285994133
  }
}
```

Status `201`. Errors: `NOT_A_REPOSITORY`, `INVALID_BASE_REF`, `PROJECT_EXISTS` (the repository is already registered), `INVALID_REQUEST`.

`GET /api/v0/admin/projects` returns `{"projects": [Project, …]}`.

### Workflows

A workflow belongs to a project. It has one mutable draft with a revision number, and immutable numbered versions. Runs always use the active version. The document format is described in [Workflows and runs](workflows.md).

`POST /api/v0/admin/workflows` creates a workflow with its first draft.

| Field       | Type             | Notes                                                                                                         |
| ----------- | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `projectId` | string, required |                                                                                                               |
| `name`      | string, required | 1 to 200 characters, unique within the project.                                                               |
| `draft`     | object, required | A workflow document. Missing defaults are filled in. The draft may be invalid; validation happens on publish. |
| `commandId` | string           |                                                                                                               |

Status `201` with `{"workflow": Workflow}`. Errors: `NOT_FOUND` (project), `WORKFLOW_EXISTS`, `REQUEST_TOO_LARGE` (a document over 1 MiB), `INVALID_REQUEST`.

A `Workflow`:

```json
{
  "id": "e3d785dd-39d7-432e-8fd4-2bbd1ddd2f47",
  "projectId": "03379958-7041-4506-8d6c-abc0c8691561",
  "name": "count-words",
  "enabled": true,
  "draftRevision": 0,
  "draft": { "formatVersion": 1, "nodes": [], "connections": [], "…": "…" },
  "activeVersionId": "8aa0b6c0-9d1a-469e-aedd-88fe5c17c893",
  "versions": [
    {
      "id": "8aa0b6c0-9d1a-469e-aedd-88fe5c17c893",
      "number": 1,
      "hash": "16bd1fdb7d651180240762e1cf1d16d53b9134997ff1dcaba5201f4090c4335c",
      "createdAt": 1792286010414
    }
  ],
  "createdAt": 1792286009862
}
```

`hash` is the SHA-256 of the version's canonical JSON. Key order does not affect it. `GET /api/v0/admin/workflows` returns a summary per workflow (`id`, `projectId`, `name`, `activeVersionId`). Filter by project with `?projectId=`. `GET /api/v0/admin/workflows/{id}` returns the full `Workflow`.

`PUT /api/v0/admin/workflows/{id}/draft` replaces the draft: `{"revision": N, "draft": {…}, "commandId"?}`. It succeeds only if the draft is still at revision `N`, and the revision then increases by one. Otherwise it fails with `409 REVISION_CONFLICT`. Read the workflow again and reapply your change.

`POST /api/v0/admin/workflows/{id}/publish` validates the draft and makes it the active version: `{"revision"?: N, "commandId"?}`. With `revision`, publishing fails with `REVISION_CONFLICT` if the draft has moved on, so you publish exactly what you reviewed. A draft identical to the active version (same hash) returns the workflow unchanged instead of numbering a duplicate. Errors: `INVALID_WORKFLOW`, with one diagnostic per problem.

### Runs

`POST /api/v0/admin/runs` starts the workflow's active version.

| Field        | Type             | Notes                                                                                           |
| ------------ | ---------------- | ----------------------------------------------------------------------------------------------- |
| `workflowId` | string, required |                                                                                                 |
| `input`      | any JSON         | Trigger input, `{}` by default. It must satisfy the trigger node's `inputSchema` if one is set. |
| `commandId`  | string           |                                                                                                 |

On admission Shift resolves the project's base ref to a commit and records it in the run's snapshot as `baseCommit`, together with the version's document, the project and the defaults. The run never reads the workflow or the project again. Status `201` with `{"run": Run}`. Inline nodes such as the trigger have already completed by the time the response is sent. Agent nodes run in the background, so poll `GET /runs/{id}` (or use `shift run start --wait`). Errors: `WORKFLOW_UNPUBLISHED`, `WORKFLOW_DISABLED`, `INVALID_INPUT`, `INVALID_BASE_REF`, `NOT_FOUND`, `COMMAND_CONFLICT`, `SERVER_STOPPING`, `INVALID_REQUEST`.

A `Run`, abridged from a completed run:

```json
{
  "id": "eef9be34-a2a4-47a3-ab68-e29c921bcbdc",
  "state": "COMPLETED",
  "workflowId": "e3d785dd-39d7-432e-8fd4-2bbd1ddd2f47",
  "versionId": "8aa0b6c0-9d1a-469e-aedd-88fe5c17c893",
  "versionNumber": 1,
  "repository": "/tmp/apidoc/repo",
  "baseCommit": "9430d8648de4d1c543da75780b1a5eabd81d7d69",
  "workspace": {
    "id": "73d92f1a-be79-4951-afb2-a5f570dd7d96",
    "path": "/home/me/.local/state/shift/workspaces/73d92f1a-be79-4951-afb2-a5f570dd7d96",
    "state": "READY"
  },
  "attention": null,
  "wait": null,
  "activeTime": { "usedMs": 1104, "limitMs": 14400000 },
  "outcome": { "data": { "words": 3 } },
  "createdAt": 1792286010660,
  "finishedAt": 1792286011816,
  "executions": [
    {
      "id": "e50338fc-e0ee-476d-8700-9f164b04d613",
      "node": "count",
      "type": "agent",
      "sequence": 2,
      "state": "COMPLETED",
      "port": "success",
      "output": {
        "data": { "words": 3 },
        "references": {
          "artifacts": [],
          "agentSession": {
            "kind": "agent_session",
            "id": "82da1dfa-689e-48d2-90a3-893fccc3c765",
            "projectId": "03379958-7041-4506-8d6c-abc0c8691561"
          }
        },
        "context": { "handoffs": [] }
      },
      "error": null,
      "attempts": [{ "number": 1, "state": "COMPLETED", "error": null }]
    }
  ],
  "invocations": [
    {
      "id": "12eb3c7c-f8fe-4505-a40e-e964ee74ebe6",
      "kind": "goal",
      "state": "COMPLETED",
      "correlationId": "msg_12eb3c7cf8fe4505a40ee964ee74ebe6",
      "submissions": 1,
      "acceptedSubmissions": 1
    }
  ]
}
```

| Field             | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`           | `RUNNING`, `WAITING`, `NEEDS_HUMAN`, `CANCEL_REQUESTED`, `COMPLETED`, `FAILED` or `CANCELLED`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `baseCommit`      | The commit the run started from. `null` for runs admitted before workspaces existed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `workspace`       | The run's worktree, created when its first agent node starts. `null` until then.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `attention`       | Set while the run is in `NEEDS_HUMAN`: `{"code", "explanation", …}`. See [attention codes](#run-attention-and-node-errors).                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `wait`            | Set while the run is `WAITING` to retry a step: `{"kind": "retry", "executionId", "dueAt", "attempt", "error": {"code", "message"}}`. `dueAt` is when attempt number `attempt` starts, in milliseconds since the epoch. See [automatic retries](workflows.md#automatic-retries).                                                                                                                                                                                                                                                                                    |
| `activeTime`      | `{"usedMs", "limitMs"}`: the active execution time the run has used and may use. A running attempt's time is recorded every 2 seconds. See [active time](workflows.md#active-time).                                                                                                                                                                                                                                                                                                                                                                                 |
| `cancelRequested` | True once the run was asked to cancel. A run in `NEEDS_HUMAN` with this set can only be cancelled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `controls`        | The owner commands applied to the run, oldest first: `{id, kind, executionId, actor, payload, createdAt}`. A `complete` keeps the result it recorded in `payload.data`, so a manual result is never mistaken for an agent's.                                                                                                                                                                                                                                                                                                                                        |
| `outcome`         | How the run ended. A run that reached an `end` node or a node without an outgoing connection has `{"data": …}` with the last output's data, plus `reason` when an `end` node set one. That applies even when an `end` node marks the run `FAILED`. A node failure without an `error` connection has the error itself, `{"code", "category", "message"}`.                                                                                                                                                                                                            |
| `executions`      | One entry per node activation in order. A loop produces several entries for the same `node`. `state` is `PENDING`, `RUNNING`, `WAITING`, `COMPLETED`, `FAILED` or `CANCELLED`. `port` is the output port taken. `output` is the node's [output envelope](workflows.md#output-envelope). `error` is `{"code", "category", "message"}` for a failed execution. `attempts` lists its attempts in order as `{number, state, error}`; an attempt is `RUNNING`, `COMPLETED`, `FAILED`, `INTERRUPTED` or `CANCELLED`, and a retried attempt keeps the error that ended it. |
| `invocations`     | Agent prompts sent for the run. `kind` is `goal`, `correction` or `continuation`. `state` is `PREPARING`, `SUBMITTING`, `RUNNING`, `UNCERTAIN`, `COMPLETED`, `FAILED`, `INTERRUPTED` or `UNKNOWN`. `correlationId` is the OpenCode message ID, so you can find the turn in OpenCode. `submissions` counts result-tool calls and `acceptedSubmissions` those Shift accepted.                                                                                                                                                                                         |

`GET /api/v0/admin/runs` lists the 100 newest runs, newest first, each as `{id, state, workflowId, createdAt, finishedAt}`.

### Run controls

These commands resolve a run waiting in `NEEDS_HUMAN`, or cancel any unfinished run. A run that is `WAITING` for an automatic retry accepts only `cancel`. Each takes a JSON body with an optional `commandId` and returns `200 {"run": Run}` as committed with the command. Work the command unblocks, such as the next inline step, runs immediately afterwards, so read the run again (or use `--wait`) to see where it went. Each command is recorded in the run's `controls`.

The stuck step is the execution the run stopped at: an agent whose turn ended without evidence of its effects, or one that was interrupted too often. Shift never rewrites what it observed about that step. The stopped attempt and its uncertain invocations stay in history, and the command decides what happens next.

| Command    | Body                                     | Allowed when                                                | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ---------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cancel`   | `{"reason"?}`                            | `RUNNING`, `WAITING` or `NEEDS_HUMAN`                       | Pending, waiting and stuck steps are cancelled at once, and a pending retry never runs. A running agent is stopped through OpenCode, and the run shows `CANCEL_REQUESTED` until that is confirmed. It then becomes `CANCELLED` with `outcome: {"cancelled": true, "reason"?}`. If the stop cannot be confirmed, the run waits in `NEEDS_HUMAN` with `CANCEL_UNCONFIRMED`. Check the workspace, then cancel again to finish. Cancelling a cancelled run succeeds without doing anything. |
| `retry`    | `{}`                                     | `NEEDS_HUMAN` with a stuck step                             | Starts a new attempt of the step with the same frozen input. An agent continues in the same session, with a prompt saying that the earlier attempt's effects are unknown and that it should inspect the workspace first. Use it once you have checked that running the step again is safe.                                                                                                                                                                                              |
| `fail`     | `{"reason"?}`                            | `NEEDS_HUMAN`                                               | The stuck step fails with `ABANDONED` and follows its `error` connection, or the run fails. A run stopped by an execution limit fails directly.                                                                                                                                                                                                                                                                                                                                         |
| `complete` | `{"data": …}`                            | `NEEDS_HUMAN` with a stuck agent step                       | Records a result you verified yourself as the step's output. `data` must satisfy the step's `resultSchema`, or the command fails with `422 INVALID_RESULT` and nothing changes.                                                                                                                                                                                                                                                                                                         |
| `extend`   | `{"executions": N}` or `{"activeMs": N}` | `NEEDS_HUMAN` with `EXECUTION_LIMIT` or `ACTIVE_TIME_LIMIT` | Raises the limit that stopped the run and takes the step it held. `executions` raises a node's or the run's execution limit by `N`, from 1 to 10,000. `activeMs` sets the active-time limit to what the run has used plus `N`, from 1,000 to 30 days; a turn that the limit stopped continues in a new attempt in the same session. Give the one that matches the attention code. The workflow snapshot is unchanged; the new limit is recorded in `controls` as `{scope, from, to}`.   |

Errors: `RUN_NOT_FOUND`, `RUN_STATE_CONFLICT` (the run is not in a state the command allows), `RUN_CANCEL_REQUESTED` (only `cancel` is accepted once cancellation started), `NOTHING_TO_RETRY`, `NOTHING_TO_COMPLETE`, `NOTHING_TO_EXTEND`, `INVALID_RESULT`, `INVALID_REQUEST`.

From the CLI:

```sh
shift run cancel <run-id> [--reason TEXT] [--wait]
shift run retry <run-id> [--wait]
shift run fail <run-id> [--reason TEXT]
shift run complete <run-id> --file data.json   # the file holds the data value
shift run extend <run-id> --executions 10 [--wait]
shift run extend <run-id> --active-minutes 30 [--wait]   # sends activeMs
```

### Workspaces

Each run works in its own detached Git worktree (see [workspaces](workflows.md#workspaces)).

A `Workspace`:

```json
{
  "id": "73d92f1a-be79-4951-afb2-a5f570dd7d96",
  "projectId": "03379958-7041-4506-8d6c-abc0c8691561",
  "runId": "eef9be34-a2a4-47a3-ab68-e29c921bcbdc",
  "path": "/home/me/.local/state/shift/workspaces/73d92f1a-be79-4951-afb2-a5f570dd7d96",
  "repositoryPath": "/tmp/apidoc/repo",
  "baseRef": "main",
  "baseCommit": "9430d8648de4d1c543da75780b1a5eabd81d7d69",
  "state": "READY",
  "createdAt": 1792286010710,
  "readyAt": 1792286010844,
  "retiredAt": null,
  "claimed": false
}
```

`state` is `CREATING` (recorded, worktree not yet confirmed), `READY` or `RETIRED` (removed). `claimed` is true while the owning run is unfinished, including in `NEEDS_HUMAN`.

`GET /api/v0/admin/workspaces[?projectId=]` lists workspaces newest first as `{"workspaces": […]}`. `GET /api/v0/admin/workspaces/{id}` returns `{"workspace": …}`.

`POST /api/v0/admin/workspaces/{id}/remove` takes `{"force"?: boolean, "commandId"?}`. It removes the worktree and its Git registration and marks the workspace `RETIRED`. Removing a retired workspace succeeds without doing anything. Errors:

- `409 WORKSPACE_IN_USE`: the owning run has not finished.
- `409 WORKSPACE_DIRTY`: the worktree has uncommitted or untracked changes. Pass `force: true` to discard them.
- `404 WORKSPACE_NOT_FOUND`.

## Error codes

HTTP errors returned by the endpoints above:

| Status | Codes                                                                                                                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400    | `INVALID_REQUEST`: the body is not JSON, or a body was sent to a route that takes none.                                                                                                                                                                                        |
| 403    | `INVALID_REQUEST`: the request carries a browser `Origin`.                                                                                                                                                                                                                     |
| 404    | `NOT_FOUND` (an unknown route, project or workflow), `RUN_NOT_FOUND`, `WORKSPACE_NOT_FOUND`                                                                                                                                                                                    |
| 409    | `COMMAND_CONFLICT`, `REVISION_CONFLICT`, `RUN_STATE_CONFLICT`, `RUN_CANCEL_REQUESTED`, `NOTHING_TO_RETRY`, `NOTHING_TO_COMPLETE`, `NOTHING_TO_EXTEND`, `PROJECT_EXISTS`, `WORKFLOW_EXISTS`, `WORKFLOW_UNPUBLISHED`, `WORKFLOW_DISABLED`, `WORKSPACE_IN_USE`, `WORKSPACE_DIRTY` |
| 413    | `REQUEST_TOO_LARGE`: a body over 2 MiB or a workflow document over 1 MiB                                                                                                                                                                                                       |
| 422    | `INVALID_REQUEST` (fails the request schema; see `diagnostics`), `INVALID_RESULT`, `INVALID_WORKFLOW`, `INVALID_INPUT`, `INVALID_BASE_REF`, `NOT_A_REPOSITORY`                                                                                                                 |
| 500    | `INTERNAL_ERROR`. Details are only in the server log, under the same `requestId`.                                                                                                                                                                                              |
| 503    | `SERVER_STOPPING`                                                                                                                                                                                                                                                              |

The CLI adds errors of its own: `ADMIN_UNAVAILABLE` (no server is listening on the socket), `UNSAFE_STATE_DIRECTORY`, `ADMIN_INVALID_RESPONSE` and `INVALID_CONFIGURATION` (bad options). `shift serve` itself can fail at startup with `INSTANCE_ALREADY_RUNNING`, `INVALID_CONFIGURATION`, `SQLITE_*`, `MIGRATION_*` or `UNSAFE_STATE_*` codes.

### Run attention and node errors

These codes are never HTTP errors. They appear inside a run: in `attention` when the run waits for a human, and in an execution's `error` when a node fails.

| Where        | Code                                                                    | Meaning                                                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `attention`  | `HARNESS_OUTCOME_UNKNOWN`                                               | An agent turn stopped without evidence of what it did, for example because Shift or OpenCode died while a tool ran. Nothing is resubmitted automatically.                            |
| `attention`  | `HARNESS_STOP_UNCONFIRMED`                                              | Shift asked the agent to stop but could not confirm that its tools stopped.                                                                                                          |
| `attention`  | `HARNESS_LOST_PROMPT`                                                   | OpenCode no longer has a prompt it had accepted.                                                                                                                                     |
| `attention`  | `HARNESS_UNAVAILABLE`                                                   | OpenCode could not be inspected after a prompt may have reached it.                                                                                                                  |
| `attention`  | `AGENT_INTERRUPTED`                                                     | The turn was interrupted more times than the continuation limit allows.                                                                                                              |
| `attention`  | `EXECUTION_LIMIT`                                                       | A loop reached a node or run execution limit.                                                                                                                                        |
| `attention`  | `ACTIVE_TIME_LIMIT`                                                     | The run used its active execution time, before a step or during an agent turn, which was stopped. Has `limit: {scope: "active", value}`.                                             |
| `attention`  | `CANCEL_UNCONFIRMED`                                                    | A cancellation could not confirm that the agent stopped. Only `cancel` is accepted.                                                                                                  |
| node `error` | `ABANDONED`                                                             | The owner abandoned the step with `fail` (`external`).                                                                                                                               |
| node `error` | `RESULT_MISSING`, `RESULT_REJECTED`                                     | The agent ended without a result Shift accepted, after the correction prompts ran out (`contract`).                                                                                  |
| node `error` | `PROVIDER_AUTH`, `PROVIDER_ERROR`, `HARNESS_TURN_FAILED`                | OpenCode or the model provider failed the turn, for example with a refused credential (`external`). No correction is attempted. `PROVIDER_ERROR` is retried when the node allows it. |
| node `error` | `HARNESS_START_FAILED`, `HARNESS_REQUEST_FAILED`, `HARNESS_UNAVAILABLE` | OpenCode could not be started or reached before a prompt was sent (`external`). Retried when the node allows it.                                                                     |
| node `error` | `HARNESS_PROMPT`                                                        | The agent asked for a permission or an answer, which unattended runs cannot give (`blocked`).                                                                                        |
| node `error` | `WORKSPACE_UNAVAILABLE`                                                 | The run's worktree could not be created, or was deleted outside Shift (`external`).                                                                                                  |
| node `error` | `BINDING_MISSING`, `MODEL_REQUIRED`, `OUTPUT_TOO_LARGE`                 | The node's inputs or configuration could not be resolved (`input`).                                                                                                                  |
| node `error` | any agent code                                                          | A `blocked` or `failed` result from the agent keeps the agent's own code (`blocked` or `external`).                                                                                  |

`category` is one of `input`, `contract`, `blocked`, `permission`, `external` and `internal`. A failed node follows its `error` connection when the workflow has one. Otherwise the run fails, and the error becomes its `outcome`.
