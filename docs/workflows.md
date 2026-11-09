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

| Type             | Config                                                                                                                                                                                                                           | Ports                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `manual_trigger` | Optional `inputSchema`, a JSON Schema (2020-12) that the run's input must satisfy. Each workflow has exactly one.                                                                                                                | `success`                           |
| `transform`      | Required `data`: a JSON template in which every `{"$binding": "<name>"}` object is replaced by that binding's value, and [operations](#transform-operations) are computed.                                                       | `success`, `error`                  |
| `agent`          | Required `goal`, with `{{name}}` placeholders. Optional `model`, `readOnly`, `resultSchema`, `limits`, `reports` and `handoffs`. See [agent nodes](#agent-nodes).                                                                | `success`, `error`                  |
| `condition`      | Required `when`, a [rule](#conditions-and-switches). Passes its input through.                                                                                                                                                   | `true`, `false`, `error`            |
| `switch`         | Required `cases`: up to 20 `{"port", "when"}` in order. The first case whose rule holds selects its `port`; none selects `default`. Passes its input through.                                                                    | one per case, `default`, `error`    |
| `wait`           | Exactly one of `durationMs` (up to 366 days) or `until`, an ISO 8601 time with an offset such as `2026-11-01T09:00:00Z`; `until` can use `{{name}}` bindings. Passes its input through when the time comes. See [waits](#waits). | `success`, `error`                  |
| `human_input`    | Required `title` and `form`; optional `instructions` and `timeoutMs`. `title` and `instructions` can use `{{name}}` bindings. See [human requests](#human-requests).                                                             | `success`, `timeout`, `error`       |
| `approval`       | Required `title`; optional `instructions`, `outcomes` (default `["approved", "rejected"]`), `form` (default: an optional `comment`) and `timeoutMs`.                                                                             | one per outcome, `timeout`, `error` |
| `set_variable`   | Required `key` and `value`, a template like a transform's `data`. Writes the [run variable](#run-variables) and passes its input through.                                                                                        | `success`, `error`                  |
| `get_variable`   | Required `key`; optional `optional` with an explicit `fallback`. Publishes the variable's current value as its data.                                                                                                             | `success`, `error`                  |
| `command`        | Exactly one of `executable` with `args`, or `mode: "shell"` with `script`. Optional `cwd`, `env`, `credentials`, `timeoutMs`, `maxOutputBytes`, `parseJson` and `safeToRetry`. See [actions](#actions).                         | `success`, `error`                  |
| `http`           | Required `url`; optional `method`, `headers`, `credentialHeaders`, `body`, `timeoutMs`, `maxResponseBytes`, `responseSchema`, `followRedirects` and `safeToRetry`. See [actions](#actions).                                   | `success`, `error`                  |
| `script`         | Advanced. Required `source`, the body of an async JavaScript function `(input, bindings)` returning JSON; optional `timeoutMs`, `resultSchema` and `safeToRetry`. See [actions](#actions).                                    | `success`, `error`                  |
| `end`            | Optional `outcome` (`COMPLETED` or `FAILED`, default `COMPLETED`) and `reason`.                                                                                                                                                  | none                                |

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

| Kind       | Reads                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `trigger`  | The run input.                                                                                                    |
| `input`    | The incoming [output envelope](#output-envelope) from the previous node, so data paths start with `data`.         |
| `project`  | `{id, name, repositoryPath, baseRef}` of the run's project.                                                       |
| `literal`  | `value` itself.                                                                                                   |
| `node`     | An earlier successful execution of `nodeId` on the current path. See [execution selectors](#execution-selectors). |
| `variable` | The current value of the [run variable](#run-variables) `key`.                                                    |

`path` walks object keys and array indexes. A path that finds nothing fails the node with `BINDING_MISSING`. A `node` or `variable` binding with `optional: true` must state an explicit `fallback` (it can be `null`) and uses it instead. Bindings are resolved once, when an execution starts, and frozen with it, so recovery and later attempts see the same values.

### Execution selectors

A `node` binding's `execution` picks which earlier execution of `nodeId` it reads. Only successful executions on the current path qualify: the chain of executions that led to this one, back to the trigger. Every pass of a loop is on that path, so a pass that skipped the producer can still read the one before it.

| `execution`               | Reads                                         |
| ------------------------- | --------------------------------------------- |
| `"latest"`                | The nearest one.                              |
| `"first"`                 | The earliest one.                             |
| `{"sequence": N}`         | The one with that sequence number in the run. |
| `{"executionId": "<id>"}` | That execution.                               |

If `latest` or `first` finds no execution, or its path finds nothing, the value is missing: the node fails with `BINDING_MISSING` unless the binding is optional. A `sequence` or `executionId` that names anything else fails the node with `BINDING_UNAVAILABLE`, even when the binding is optional. That includes an execution that failed, one that comes later, one on another branch and one in another run. A wrong selector is a mistake in the workflow, not a missing value.

Each execution records where its bindings came from, as its `sources` in the run view. The record has the producing execution and sequence for `node`, `input` and `trigger` bindings, and marks a fallback that was used. With each execution's `predecessorId` and `connectionId`, this shows exactly which output every value came from.

A transform's `data` and an agent's `goal` refer to bindings by name. In `data`, an object `{"$binding": "words"}` becomes the value itself, keeping its type. In `goal`, `{{words}}` becomes text, and values that aren't strings are rendered as JSON. Referring to an undeclared binding is a validation error.

### Transform operations

A transform's `data`, and a `set_variable` node's `value`, can compute values with these objects. Each has exactly one key, and its operands are templates themselves:

| Operation                | Result                                                                |
| ------------------------ | --------------------------------------------------------------------- |
| `{"$add": [a, b]}`       | `a + b`. `$subtract` and `$multiply` work the same way. Numbers only. |
| `{"$length": value}`     | The number of items in a list, or of characters in text.              |
| `{"$at": [list, index]}` | The item at a whole-number `index`, counting from 0.                  |

An operand of the wrong type fails the node with `TRANSFORM_TYPE`, and an index outside the list with `TRANSFORM_INDEX`; neither is guessed. Publishing refuses any other object whose only key starts with `$`, and an operation with the wrong number of operands. A list is one value: nothing runs once per item. To visit each item, loop explicitly, as below.

## Run variables

A run variable is a named JSON value that belongs to one run. `set_variable` writes it, and a `variable` binding or `get_variable` reads it. Values are at most 256 KiB, and keys follow the node ID rules.

- **Writes commit with the node.** A write is stored in the same transaction that completes its execution. A failed or interrupted attempt writes nothing, and a completed one has both its output and its write.
- **Every write is a new revision.** Revisions number from 1 and keep the execution that wrote them. `shift run variables <run-id>` shows the current values and every revision.
- **Reads are frozen.** An execution reads variables once, when it starts, and keeps those values and their revisions in its `sources`. A retry, a wait or a restart sees the same values even after a later write.
- **Writes check the revision they replace.** `set_variable` records the revision it saw when it started. If the variable changed in the meantime, the node fails with `VARIABLE_CONFLICT` instead of overwriting it.

[`collection-loop.json`](examples/collection-loop.json) visits each item of the run input's `items` in turn. `init` sets `index` to 0. `look` reads `index` and the list's `$length`, and `more` compares them. While items remain, `visit` takes `{"$at": [items, index]}`, and `next` sets `index` to `{"$add": [index, 1]}` and connects back to `look`. When `index` reaches the length, the run ends. Each node's `maxExecutionsPerRun` (50 by default) bounds how many items it can visit.

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

`data` is the business result. `references.agentSession` is present on an agent node's output, and `references.artifacts` lists its reports. `context.handoffs` is the current [handoff](#reports-and-handoffs): an agent node replaces it with its own, and every other node passes it on unchanged.

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
    "limits": { "rejectedSubmissions": 3, "corrections": 2, "continuations": 2 },
    "session": { "strategy": "fresh", "lifetime": "persistent" },
    "reports": { "handoff": "required", "humanReport": "required" },
    "handoffs": { "incoming": true, "nodes": [] }
  },
  "bindings": { "file": { "kind": "trigger", "path": ["file"] } }
}
```

- `model` is `<provider>/<model>` as named in OpenCode. It defaults to the server's `--opencode-model`. Without either, the node fails with `MODEL_REQUIRED`.
- `readOnly` agents can't edit files or run shell commands. They can still write their artifact directory.
- `resultSchema` is the JSON Schema for the result's `data`. It defaults to any object.
- `session` says which [session](#sessions) the agent works in.
- `reports` says which [reports](#reports-and-handoffs) a completed result needs: `required` (the default), `optional` or `off`.
- `handoffs` says which earlier [handoffs](#reports-and-handoffs) the agent reads: the incoming one unless `incoming` is `false`, and those of the agent nodes listed in `nodes`.

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

### Reports and handoffs

Each prompt Shift sends gets its own report directory, named in the prompt. Before submitting a completed result, the agent writes two Markdown files there:

- `tothenextagent.md`, the **handoff**: what it did, its decisions, the current state and what is left, for the agent that continues.
- `toahumanreader.md`, the **human report**: a short account for the workflow's owner.

Shift stores each as an immutable [artifact](server-api.md#artifacts) of that prompt, so a correction's reports never replace the first turn's. A completed result counts only with its `required` reports: a missing, linked or oversized one gets a correction prompt that names it, and the agent writes its reports again and resubmits. When corrections run out, the node fails with `REPORTS_MISSING`. A blocked or failed result needs no reports and keeps its own code. A report set to `off` is not asked for.

The successful prompt's reports become the node's `references.artifacts`, and its handoff becomes `context.handoffs`. Without a handoff the list is empty; an older handoff is never passed on as the agent's. Transforms, conditions, waits and other nodes pass `context.handoffs` along, so an agent two steps later still receives it.

An agent reads the incoming handoff, inline in its prompt, or as a file in its report directory when it is over 64 KiB. Set `handoffs.incoming` to `false` for an independent reviewer that should judge the work without the author's notes. List agent nodes in `handoffs.nodes` to add their latest handoffs on the run's path; each must name another agent node. The handoffs are fixed when the node starts, and every goal prompt repeats them, also when a session is reused. Only a handoff that a successful execution on the run's own path published as its node's handoff is handed on; any other reference in the context, such as a human report, another run's artifact or the handoff of a turn that was later corrected, is ignored.

### Sessions

An agent works in a session: a Shift identity for one OpenCode conversation, in one project and one workspace. `session.strategy` chooses it:

| Strategy    | Session                                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fresh`     | The default. A new session for each execution of the node.                                                                                                      |
| `per_run`   | One session per run and node: the first visit creates it, and later visits in a loop reuse it.                                                                  |
| `reference` | The existing session named by `session.reference`, from any earlier run of the project. The agent works in that session's workspace, since sessions never move. |

`session.lifetime` is `persistent` (the default) or `ephemeral`. A persistent session outlives its execution and run, and waits `IDLE` for its next goal. An ephemeral one is archived when its execution ends, and only the `fresh` strategy can be ephemeral. A `reference` keeps the referenced session's own lifetime, so it takes no `lifetime`.

A session stays the same across an execution's attempts: retries and continuations reuse it. Every goal prompt still states the task, input and handoffs in full, so a reused conversation is never the only source of what to do now.

One execution at a time owns a session. A `reference` also needs the session's workspace: it waits while the run that created the workspace is still active, and while another execution uses the session or workspace. A waiting execution takes no agent slot; the run shows `wait: {"kind": "resource", "resourceType", "resourceId", "heldBy"}`, and waiters go in the order they asked. Referencing a session of another project, an archived one, or one whose workspace was removed fails the node with `SESSION_UNAVAILABLE`. If OpenCode no longer has a reused session's conversation, the run waits in `NEEDS_HUMAN` with `SESSION_MISSING`; Shift never starts a new conversation in its place.

## Actions

Command, HTTP and Script nodes act outside Shift. They run code and requests you wrote, as your own account. Shift accounts for them but does not sandbox them against you.

- **Command** runs `executable` with `args`, never through a shell: a `{{name}}` binding in an argument is always one argument. `mode: "shell"` runs `script` with `/bin/sh -c` instead. Bindings never fill a shell script; set them in `env` and read them as variables. The command runs in the run's worktree, or in `cwd` inside it. It inherits only `PATH`, `HOME`, the user, locale and terminal settings, `SSH_AUTH_SOCK` and the XDG directories, plus `SHIFT_RUN_ID`, `SHIFT_EXECUTION_ID` and its own `env`. Its data is `exitCode`, `signal`, the last `maxOutputBytes` (default 64 KiB, at most 256 KiB) of `stdout` and `stderr` with their byte counts and `…Truncated` flags, `durationMs`, and with `parseJson` the parsed `json`. A nonzero exit fails with `COMMAND_FAILED` and a timeout (default 10 minutes) with `COMMAND_TIMED_OUT`, both carrying that data in `details`.
- **HTTP** sends one request. `{{name}}` bindings fill the URL, header values and a `text` body; a `json` body is a Transform template. Its data is `status`, `headers`, `body` (parsed when the response is JSON) and `bodyBytes`. A status outside 2xx fails with `HTTP_STATUS`, a body larger than `maxResponseBytes` (default and maximum 1 MiB) with `HTTP_RESPONSE_TOO_LARGE`, and a body that does not match `responseSchema` with `HTTP_RESPONSE_INVALID`. Redirects are returned, not followed, unless `followRedirects` is set.
- **Script** runs its source in a separate Node process with Node's permission model, so it cannot read files or start processes, a 256 MiB heap and `timeoutMs` (default 10 seconds). It gets the input's data and the bindings, and no credentials or environment. What it prints is kept as logs; what it returns is its data, checked against `resultSchema`.

Commands and scripts run in their own systemd scope, so a timeout, a cancellation or a restart stops every process they started, including ones left in the background. They need a systemd user manager (`ACTION_CONTAINMENT_UNAVAILABLE` otherwise).

**Credentials** are project secrets set with `shift credential set --project <id> --name <name>`, which reads the value from standard input. A command names them in `credentials` (`{"ENV_NAME": "<credential>"}`), a request in `credentialHeaders` (`{"Authorization": {"credential": "<credential>", "prefix": "Bearer "}}`). Values are injected when the action runs and are removed from captured output where they appear verbatim; they are never stored in the run, its operations, receipts or events. A run can use the credentials the project had when it started, unless they were revoked since (`CREDENTIAL_UNAVAILABLE`).

**Permissions.** `shift project permissions <id> --deny command,http,script,git,git_push` stops those actions in the project, including in runs that already started (`ACTION_NOT_PERMITTED`); `--allow` lifts it. Everything is allowed until denied.

**Effects and uncertainty.** Each run of an action is an operation, listed in the execution's `operations`. Its arguments are recorded with a hash before anything happens, and it is marked submitted right before the process starts or the request is sent. A known outcome is stored before the run moves on and is never repeated: after a restart it is reported again. An operation that was submitted when Shift stopped has an unknown outcome. Shift then stops whatever is left of it and puts the run in `NEEDS_HUMAN` with `EFFECT_UNCERTAIN`, unless repeating it is safe: an HTTP `GET`, `HEAD` or `OPTIONS`, or a node with `safeToRetry`, which you set when running it twice does no harm, such as a test command. Those start again as a new operation. A request that never left the machine, and a server error on a safe read, follow the node's [automatic retries](#automatic-retries). `retry` sets the uncertain operation aside, recording that you decided, and runs a new one; `complete` records the data you verified.

## Workspaces

When a run starts, Shift resolves the project's base ref to a commit and records it as the run's `baseCommit`. Before the first agent node runs, Shift creates a detached worktree at that commit under `<state>/workspaces/<id>`. All of the run's agents work there.

- Later commits to the base ref never affect a started run.
- The project's own checkout is never modified. Git only records the worktree under `.git/worktrees`. Git hooks such as `post-checkout` run, as they would for you.
- Worktrees are kept after the run finishes, so you can inspect the agent's work or commit it. `shift workspace remove <id>` deletes one. It refuses while the run is unfinished, including in `NEEDS_HUMAN`, and refuses uncommitted changes unless `--force` is given.
- A workspace interrupted while being created is discarded and created again. A ready worktree deleted outside Shift fails the agent node with `WORKSPACE_UNAVAILABLE`. Shift doesn't recreate it, because that would hide lost work.

Runs started before workspaces existed keep working in the repository itself.

## Run states

| State              | Meaning                                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUNNING`          | Nodes are executing or about to.                                                                                                                                                                                                            |
| `WAITING`          | A human request waits for an answer, a Wait node for its time, or a step failed temporarily and waits to be retried. `wait` says which; see [human requests](#human-requests), [waits](#waits) and [automatic retries](#automatic-retries). |
| `NEEDS_HUMAN`      | The run stopped because it can't continue safely. `attention` says why. Continue it with `shift run retry`, `fail`, `complete` or `extend`, or cancel it; see [owner decisions](#owner-decisions).                                          |
| `CANCEL_REQUESTED` | `shift run cancel` was accepted, and Shift is stopping the running agent.                                                                                                                                                                   |
| `CANCELLED`        | The run was cancelled. Work completed before cancellation is kept; nothing is rolled back.                                                                                                                                                  |
| `COMPLETED`        | The run reached an `end` node or an unconnected port. `outcome` holds the final data.                                                                                                                                                       |
| `FAILED`           | A node failed without an `error` connection, or an `end` node declared `FAILED`.                                                                                                                                                            |

## Conditions and switches

`condition` and `switch` nodes choose a branch from a rule, and pass their input on unchanged. A rule is either a comparison or a group of rules:

```json
{
  "id": "check",
  "type": "condition",
  "config": {
    "when": {
      "all": [
        { "op": "exists", "left": { "binding": "count" } },
        { "op": "lt", "left": { "binding": "count" }, "right": { "value": 3 } }
      ]
    }
  },
  "bindings": { "count": { "kind": "input", "path": ["data", "count"] } }
}
```

- **Groups:** `{"all": [...]}` holds when every rule holds, and `{"any": [...]}` when at least one does. Groups nest up to 4 deep.
- **Operands:** `{"binding": "<name>"}` reads one of the node's declared bindings. `{"value": ...}` is a literal.
- **Operators:**

| `op`                     | Holds when                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `eq`, `ne`               | The two values are equal, or not equal, as JSON (objects and arrays compared deeply).   |
| `lt`, `lte`, `gt`, `gte` | Both are numbers or both are strings (compared by code unit), and the comparison holds. |
| `contains`               | The left string contains the right string, or the left array contains the right value.  |
| `in`                     | The right array contains the left value.                                                |
| `exists`                 | The left value is present and not `null`. Takes no `right`.                             |

Comparing values of the wrong types fails the node with `CONDITION_TYPE`, an `input` error that an `error` connection can route. A rule never quietly evaluates to `false` because a binding held something unexpected. A `switch` checks its cases in order and takes the first that holds, even when later cases hold too. A node that several branches lead to runs whenever one of them reaches it, with that branch's output; it never waits for the others.

## Human requests

A `human_input` node asks you to fill in a form. An `approval` node asks you to choose an outcome, optionally with a form beside it. When the node starts, Shift fills in its `title` and `instructions` from its bindings and freezes them with the form. The request then waits as an [interaction](server-api.md#interactions) until you answer it with `shift interaction respond`. Editing or republishing the workflow never changes a pending request.

A form is a restricted JSON Schema, so that a client can render it. Each field has an optional `title`, `description` and `default`, and objects accept only their declared fields. The supported field types are:

- `string`, with `minLength`, `maxLength`, `pattern`, `enum`, and `format` `date`, `date-time`, `email` or `uri`.
- `number` and `integer`, with `minimum`, `maximum` and `enum`.
- `boolean`.
- Nested `object` and `array` fields, up to 4 levels deep.

```json
{
  "id": "review",
  "type": "approval",
  "config": {
    "title": "Merge {{branch}}?",
    "outcomes": ["merge", "revise"],
    "form": { "type": "object", "properties": { "notes": { "type": "string" } } },
    "timeoutMs": 86400000
  },
  "bindings": {
    "branch": { "kind": "node", "nodeId": "plan", "execution": "latest", "path": ["branch"] }
  }
}
```

The first valid response wins. It is checked against the frozen form and the request's revision, and recorded with who gave it. The node then publishes the previous data together with the response, and keeps the incoming context:

- `human_input` publishes `{"input": <previous data>, "response": <form data>}` on `success`.
- `approval` publishes `{"input": <previous data>, "decision": "<outcome>", "response": <form data>}` on the port named after the decision. Each outcome can lead somewhere different, including back to an earlier node.

Requests wait indefinitely by default. With `timeoutMs`, a request nobody answers in time expires, and its node takes its `timeout` connection with `{"input": <previous data>, "expiredAt": <time>}`. Without a `timeout` connection, the node fails with `INTERACTION_EXPIRED`, which an `error` connection can route.

A response, the deadline and a cancellation can arrive at the same time. Whichever commits first wins, and the others are refused. Waiting costs no [active time](#active-time), and a restart keeps the request and its deadline.

## Waits

A `wait` node fixes its deadline in UTC when it starts: now plus `durationMs`, or `until` once its bindings are filled in. An `until` without an offset is refused at publish, and one that a binding turns into something else fails the node with `INVALID_DEADLINE`. A deadline that has already passed lets the input straight through.

While it waits, the run is `WAITING` with `wait: {kind: "timer", executionId, dueAt}`. Waiting costs no [active time](#active-time). The deadline is stored, so a restart keeps waiting, and a deadline that passed while Shift was stopped fires as soon as it starts, exactly once. Cancelling the run cancels the wait. `shift run show --wait` keeps waiting until the time comes.

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
| Shift killed while a command, script or request runs                         | Its processes are stopped, and the run enters `NEEDS_HUMAN` with `EFFECT_UNCERTAIN` unless repeating it is safe. A recorded outcome is reported, never repeated.                       |
| Shift stopped during a retry backoff                                         | The run keeps waiting. A retry that fell due in the meantime runs as soon as Shift starts.                                                                                              |

A restart replaces the OpenCode runtime instead of reconnecting to it, so a turn that was running when Shift crashed is always interrupted.

## Not implemented yet

Publishing refuses these, so a document never silently ignores them:

- Overlap policies other than `allow` (M12).
- Workspaces other than a new one per run (M08a).

Git and GitHub nodes, and schedule and webhook triggers are planned in the [roadmap](shift-server-v0.md#18-ordered-implementation-roadmap).
