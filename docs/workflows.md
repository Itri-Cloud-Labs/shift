# Workflows and runs

This guide covers what Shift executes today: the workflow document, the node types, how data moves between nodes, how agents report results, and what a run does when things go wrong. Specification [section 5](shift-server-v0.md#5-graph-document-and-data-contract) defines the full format, including parts not implemented yet. The [server API](server-api.md) describes the endpoints and CLI commands.

## The model

- A **project** is an existing Git repository on the server's host, together with the base ref that runs start from.
- A **workflow** belongs to a project. It has one editable **draft** and immutable, numbered **versions**. Publishing validates the draft and makes it the active version.
- A **run** executes the active version it started with. The version's document, the project and the base commit are frozen into the run when it starts, so editing, republishing or re-pointing anything later never changes a started run.
- Each node activation in a run is an **execution**. Running a node again, as in a loop, creates another execution.
- Agent nodes work in the run's **workspace**, a detached Git worktree created for that run.

```sh
shift serve --opencode-model openai/gpt-6-luna
shift project add --path /path/to/repo
shift workflow create --project <project-id> --name count-words --file docs/examples/count-words.json
shift workflow publish <workflow-id>
shift run start --workflow <workflow-id> --input '{"file":"notes.txt"}' --wait
```

## The document

A minimal document needs only `nodes` and `connections`. Everything else has defaults, which are filled in when the draft is saved. [count-words.json](examples/count-words.json) is a complete example.

```json
{
  "nodes": [
    { "id": "start", "type": "manual_trigger" },
    { "id": "end", "type": "end" }
  ],
  "connections": [
    {
      "id": "c1",
      "fromNodeId": "start",
      "fromPort": "success",
      "toNodeId": "end",
      "toPort": "input"
    }
  ]
}
```

| Field                            | Default           | Meaning                                                                  |
| -------------------------------- | ----------------- | ------------------------------------------------------------------------ |
| `formatVersion`                  | `1`               | The only supported version.                                              |
| `execution.limits.maxExecutions` | `1000`            | Executions allowed per run, across all nodes.                            |
| `execution.limits.maxActiveMs`   | 4 hours           | Active execution time allowed per run. See [active time](#active-time).  |
| `execution.workspace`            | `{"kind": "new"}` | Every run gets a new workspace. Other values are refused.                |
| `execution.overlap`              | `"allow"`         | Concurrent runs of one workflow are allowed. Other policies are refused. |
| `presentation`                   | `{}`              | Editor data. Execution ignores it.                                       |

Each node has:

| Field                        | Default           | Meaning                                                                               |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| `id`                         | required          | Unique within the document.                                                           |
| `type`                       | required          | One of the node types below.                                                          |
| `typeVersion`                | `1`               | The node type version. A published version pins it.                                   |
| `config`                     | `{}`              | Type-specific settings. Unknown keys are refused.                                     |
| `bindings`                   | `{}`              | Named values the node reads. See [bindings](#bindings).                               |
| `limits.maxExecutionsPerRun` | `50`              | How often this node may run in one run.                                               |
| `retry`                      | one attempt       | Automatic retries of temporary failures. See [automatic retries](#automatic-retries). |
| `position`                   | laid out in a row | Editor data.                                                                          |

Documents are limited to 1 MiB and a nesting depth of 32. A draft may be invalid. Publishing reports every problem at once, each with the JSON pointer of the offending field.

## Node types

| Type             | Config                                                                                                                                     | Ports              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `manual_trigger` | Optional `inputSchema`, a JSON Schema (2020-12) that the run's input must satisfy. Each workflow has exactly one.                          | `success`          |
| `transform`      | Required `data`: a JSON template in which every `{"$binding": "<name>"}` object is replaced by that binding's value.                       | `success`, `error` |
| `agent`          | Required `goal`, with `{{name}}` placeholders. Optional `model`, `readOnly`, `resultSchema` and `limits`. See [agent nodes](#agent-nodes). | `success`, `error` |
| `end`            | Optional `outcome` (`COMPLETED` or `FAILED`, default `COMPLETED`) and `reason`.                                                            | none               |

The trigger's output is the run input. A transform's output is its rendered template, at most 1 MiB. An `end` node passes its input through and finishes the run with its declared outcome.

## Connections

A connection joins one node's output port to another node's `input`.

- Each output port has at most one connection. There is no fan-out yet, so a run follows one path.
- Nothing may connect into the trigger.
- When a node finishes, the run follows the connection from the port it took. A port without a connection completes the run successfully with that node's output.
- A failed node takes its `error` port when it has a connection there. The next node receives `{"error": {"code", "category", "message"}}` as its data. Without an `error` connection the run fails.
- Loops are ordinary connections back to an earlier node. Each pass creates a new execution. When a node reaches `limits.maxExecutionsPerRun`, or the run reaches `execution.limits.maxExecutions`, the run stops in `NEEDS_HUMAN` with `EXECUTION_LIMIT` before running anything else. `shift run extend` raises the limit for that run.

## Bindings

A binding names a value, which the node's config refers to by that name.

```json
"bindings": {
  "file":   { "kind": "trigger", "path": ["file"] },
  "words":  { "kind": "input", "path": ["data", "words"] },
  "repo":   { "kind": "project", "path": ["name"] },
  "mode":   { "kind": "literal", "value": "strict" },
  "review": { "kind": "node", "nodeId": "review", "execution": "latest", "path": ["data"], "optional": true, "fallback": null }
}
```

| Kind      | Reads                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------- |
| `trigger` | The run input.                                                                                            |
| `input`   | The incoming [output envelope](#output-envelope) from the previous node, so data paths start with `data`. |
| `project` | `{id, name, repositoryPath, baseRef}` of the run's project.                                               |
| `literal` | `value` itself.                                                                                           |
| `node`    | An earlier successful execution of `nodeId` on the current path: the `latest` one, or the `first`.        |

`path` walks object keys and array indexes. A path that finds nothing fails the node with `BINDING_MISSING`. A `node` binding with `optional: true` must state an explicit `fallback` (it can be `null`) and uses it instead. Bindings are resolved once, when an execution starts, and frozen with it, so recovery and later attempts see the same values.

A transform's `data` and an agent's `goal` refer to bindings by name. In `data`, an object `{"$binding": "words"}` becomes the value itself, keeping its type. In `goal`, `{{words}}` becomes text, and values that aren't strings are rendered as JSON. Referring to an undeclared binding is a validation error.

## Output envelope

Every node publishes the same envelope, and the next node receives it as its input:

```json
{
  "data": { "words": 3 },
  "references": {
    "artifacts": [],
    "agentSession": { "kind": "agent_session", "id": "…", "projectId": "…" }
  },
  "context": { "handoffs": [] }
}
```

`data` is the business result. `references.agentSession` is present on an agent node's output. `context` carries handoffs forward unchanged.

## Agent nodes

```json
{
  "id": "count",
  "type": "agent",
  "config": {
    "goal": "Count the words in {{file}}.",
    "model": "openai/gpt-6-luna",
    "readOnly": true,
    "resultSchema": {
      "type": "object",
      "required": ["words"],
      "properties": { "words": { "type": "integer" } }
    },
    "limits": { "rejectedSubmissions": 3, "corrections": 2, "continuations": 2 }
  },
  "bindings": { "file": { "kind": "trigger", "path": ["file"] } }
}
```

- `model` is `<provider>/<model>` as named in OpenCode. It defaults to the server's `--opencode-model`. Without either, the node fails with `MODEL_REQUIRED`.
- `readOnly` agents can't edit files or run shell commands. They can still write their artifact directory.
- `resultSchema` is the JSON Schema for the result's `data`. It defaults to any object.

Agents run on the server account's own OpenCode install, with its configuration, credentials, plugins and MCP servers. Each agent works in the run's worktree.

### How an agent reports its result

The agent ends its task by calling Shift's `shift_submit_result` tool with one of three results:

- `{"status": "completed", "data": …}`: success. `data` must satisfy `resultSchema`.
- `{"status": "blocked", "blocker": {"code", "message"}}`: the agent can't proceed, for example because an input is missing.
- `{"status": "failed", "error": {"code", "message"}}`: the task failed.

Shift validates each call during the turn and accepts or rejects it, so the agent can fix a rejected result straight away. Once Shift accepts a result, it stands, even if the turn is then interrupted or its outcome can't be established. A completed result becomes the node's `success` output. A blocker or failure fails the node with the agent's own code, routed through its `error` connection if it has one.

The `limits` bound the remedies:

| Limit                 | Default | Applies when                                                                                                                                                                                             |
| --------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rejectedSubmissions` | 3       | Shift rejected this many submissions in one turn. Shift stops the turn, which then counts as a turn without a result.                                                                                    |
| `corrections`         | 2       | A turn ended without an accepted result. Shift sends a correction prompt in the same session. When corrections run out, the node fails with `RESULT_MISSING`.                                            |
| `continuations`       | 2       | A turn was interrupted before it did anything, or Shift stopped it cleanly. Shift continues it in the same session. When continuations run out, the run waits in `NEEDS_HUMAN` with `AGENT_INTERRUPTED`. |

A turn that OpenCode or the model provider fails, for example with a refused credential, gets no correction. The node fails at once with `PROVIDER_AUTH`, `PROVIDER_ERROR` or `HARNESS_TURN_FAILED`. An agent that asks for a permission or an answer is stopped, because unattended runs can't give one, and the node fails with `HARNESS_PROMPT`.

## Workspaces

When a run starts, Shift resolves the project's base ref to a commit and records it as the run's `baseCommit`. Before the first agent node runs, Shift creates a detached worktree at that commit under `<state>/workspaces/<id>`. All of the run's agents work there.

- Later commits to the base ref never affect a started run.
- The project's own checkout is never modified. Git only records the worktree under `.git/worktrees`. Git hooks such as `post-checkout` run, as they would for you.
- Worktrees are kept after the run finishes, so you can inspect the agent's work or commit it. `shift workspace remove <id>` deletes one. It refuses while the run is unfinished, including in `NEEDS_HUMAN`, and refuses uncommitted changes unless `--force` is given.
- A workspace interrupted while being created is discarded and created again. A ready worktree deleted outside Shift fails the agent node with `WORKSPACE_UNAVAILABLE`. Shift doesn't recreate it, because that would hide lost work.

Runs started before workspaces existed keep working in the repository itself.

## Run states

| State              | Meaning                                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUNNING`          | Nodes are executing or about to.                                                                                                                                                                   |
| `WAITING`          | A step failed temporarily and waits to be retried. `wait` says when; see [automatic retries](#automatic-retries).                                                                                  |
| `NEEDS_HUMAN`      | The run stopped because it can't continue safely. `attention` says why. Continue it with `shift run retry`, `fail`, `complete` or `extend`, or cancel it; see [owner decisions](#owner-decisions). |
| `CANCEL_REQUESTED` | `shift run cancel` was accepted, and Shift is stopping the running agent.                                                                                                                          |
| `CANCELLED`        | The run was cancelled. Work completed before cancellation is kept; nothing is rolled back.                                                                                                         |
| `COMPLETED`        | The run reached an `end` node or an unconnected port. `outcome` holds the final data.                                                                                                              |
| `FAILED`           | A node failed without an `error` connection, or an `end` node declared `FAILED`.                                                                                                                   |

## Automatic retries

A node's `retry` setting retries failures that are temporary, so another attempt can succeed:

```json
{
  "id": "count",
  "type": "agent",
  "config": { "goal": "…" },
  "retry": { "maxAttempts": 3, "initialDelayMs": 1000, "maxDelayMs": 60000 }
}
```

`maxAttempts` counts every attempt, including the first, from 1 (the default, no retries) to 100. The wait before attempt _n_ + 1 is `initialDelayMs` × 2<sup>_n_ − 1</sup>, capped at `maxDelayMs`, and then shortened by a random amount of up to half so that runs that failed together don't retry together. Both delays are at most 24 hours.

Only these failures are retried:

| Code                                                                    | Why it is safe                                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `PROVIDER_ERROR`                                                        | The model provider failed the request, for example with HTTP 429 or 503.             |
| `HARNESS_START_FAILED`, `HARNESS_REQUEST_FAILED`, `HARNESS_UNAVAILABLE` | OpenCode could not be started or reached before any prompt was sent for the attempt. |

Everything else fails at once: a refused credential (`PROVIDER_AUTH`), a failed turn, a result the agent never got right, a blocker, and errors in the node's inputs would fail the same way again. A turn whose outcome is unknown is never retried automatically, because its tools may have had effects; it waits in `NEEDS_HUMAN` as before.

While it waits, the run is `WAITING` and its `wait` shows the attempt that comes next, when it is due and the error that caused it. The failed attempt stays in the execution's `attempts`. The next attempt uses the same frozen input. An agent continues in the same session, and its first prompt names the error and asks it to inspect the workspace before going on, since the failed turn may have done part of the work. When the attempts run out, the last error is handled like any other failure: it follows the node's `error` connection, or the run fails.

Wake-ups are stored with their due time, so a restart during a backoff keeps waiting, and a retry that fell due while Shift was stopped runs when it starts. Cancelling a waiting run cancels it immediately, and the retry never runs. `shift run show --wait` keeps waiting through a backoff.

## Active time

`execution.limits.maxActiveMs` bounds how long a run's attempts may spend running, in total. Only running attempts count. Waiting for a retry, or in `NEEDS_HUMAN`, costs nothing. The run's `activeTime` shows `{usedMs, limitMs}`.

Shift records the time of each running attempt every 2 seconds and when the attempt ends. When a run reaches its limit:

- **Between steps,** it stops in `NEEDS_HUMAN` with `ACTIVE_TIME_LIMIT` before the next step starts.
- **During an agent turn,** Shift stops the turn through OpenCode, the same way as a cancellation, and the run then waits in `NEEDS_HUMAN` with `ACTIVE_TIME_LIMIT`. If the stop could not be confirmed, the explanation says that the agent's effects are unknown.

`shift run extend <run> --active-minutes N` gives the run `N` more minutes beyond what it has used and continues where it stopped. A turn that was stopped continues in a new attempt in the same session. `fail`, `complete` and `cancel` work as for any stuck step.

After a crash, Shift can't tell whether a running attempt's tools kept working until the restart, so it charges the whole time since the attempt's last record, and adds a `run.active_time_charged` event explaining it. A long outage during a running agent turn can therefore use up a run's active time.

## Owner decisions

A run waits in `NEEDS_HUMAN` when Shift cannot tell what happened, for example after an agent's tools were killed mid-turn, or when a loop reached its limit. Only you can decide what is true, so Shift asks instead of guessing:

| Command                                     | Use it when                                                                                                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shift run retry <run>`                     | You checked the workspace and running the step again is safe. The agent continues in its session and is told that the earlier attempt's effects are unknown, so it inspects the workspace before acting. |
| `shift run complete <run> --file data.json` | The step's work is in fact done and you can state its result. The result must satisfy the step's `resultSchema`, and it is recorded as yours.                                                            |
| `shift run fail <run> [--reason]`           | The step should not continue. It fails with `ABANDONED` and follows its `error` connection, or the run fails.                                                                                            |
| `shift run extend <run> --executions N`     | A loop reached its limit and should keep going. The limit is raised by `N`; the workflow itself is unchanged.                                                                                            |
| `shift run extend <run> --active-minutes N` | The run used its [active time](#active-time) and should keep going. It gets `N` more minutes beyond what it has used.                                                                                    |
| `shift run cancel <run>`                    | The run should stop. It works at any point, not only in `NEEDS_HUMAN`.                                                                                                                                   |

Every decision is recorded in the run's `controls`, and the stopped attempt stays in history as Shift observed it. A cancellation that cannot confirm that the agent stopped waits in `NEEDS_HUMAN` with `CANCEL_UNCONFIRMED`. Check the workspace, then cancel again. While a cancellation is pending, only cancel is accepted. A cancellation interrupted by a restart finishes on the next start.

## Crashes and restarts

Runs, executions, attempts, agent sessions, prompts and result submissions are stored in SQLite. Every step that leaves Shift is recorded as an intent before it happens. Stopping or killing either process is handled as follows:

| Situation                                                                    | Result                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shift stop` during an agent turn                                            | The turn is cancelled through OpenCode. The next start continues it in the same session.                                                                                                |
| Shift killed before the prompt reached OpenCode                              | The next start sends it once, under the same message ID.                                                                                                                                |
| Shift killed after OpenCode accepted the prompt but before the agent started | The next start continues in the same session.                                                                                                                                           |
| Shift or OpenCode killed while the agent's tools run                         | The tools are killed with OpenCode's process scope, and the run enters `NEEDS_HUMAN` with `HARNESS_OUTCOME_UNKNOWN`. Nothing is resent, because the tools may already have had effects. |
| OpenCode finishes the turn while Shift is down                               | The agent's result call fails, so the turn ends without an accepted result. Its correction prompt says not to redo completed work.                                                      |
| Shift stopped during a retry backoff                                         | The run keeps waiting. A retry that fell due in the meantime runs as soon as Shift starts.                                                                                              |

A restart replaces the OpenCode runtime instead of reconnecting to it, so a turn that was running when Shift crashed is always interrupted.

## Not implemented yet

Publishing refuses these, so a document never silently ignores them:

- Run variables (M04a).
- Overlap policies other than `allow` (M12).
- Workspaces other than a new one per run (M08a).

Human and timer waits, Git and GitHub nodes, and schedule and webhook triggers are planned in the [roadmap](shift-server-v0.md#18-ordered-implementation-roadmap).
