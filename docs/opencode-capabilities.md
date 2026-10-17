# OpenCode v2 capabilities for the Shift adapter

Status: evidence recorded 2026-10-16 against **OpenCode v2.0.26** (`opencode serve`, the v2 HTTP API) on Linux x64, Node 24.19.0, model `opencode-go/claude-haiku-5-5`. The final full run passed all 14 cases for $0.0047. An earlier full run ($0.0063) passed 13. Its one failure was a probe assertion that expected HTTP 200 where OpenCode returns 204, which has since been fixed. This document supplies the adapter evidence the [server specification](shift-server-v0.md) section 11.2 asks for. Section 7 below proposes the specification changes this evidence implies; none of them have been applied to the specification yet.

## 1. Rerun the probe

```sh
node apps/server/tools/opencode-probe/probe.mjs --out /tmp/opencode-probe.json
node apps/server/tools/opencode-probe/probe.mjs --only session-identity,event-replay   # no model calls
```

The probe ([probe.mjs](../apps/server/tools/opencode-probe/probe.mjs)) creates a private temporary `HOME`, `XDG_*` and `TMPDIR` tree, a temporary Git repository and its own `opencode serve` process. It installs the probe [result plugin](../apps/server/tools/opencode-probe/plugin/index.mjs) and runs a Shift-side Ajv validator on loopback. It signals the server only after confirming that the process environment points at its own data directory. Cleanup kills every process that inherited that private `XDG_DATA_HOME`, which includes untagged tool children such as `sleep`, plus members of any marker-tagged tool process group whose cwd is inside the probe tree. It waits for them to exit before reporting the remaining count, then deletes the tree unless `--keep` is given. A case that cannot reach the state it examines reports `inconclusive`, never `observed`.

Model cases need an API-key credential for the model's provider, from `SHIFT_PROBE_API_KEY` or the `--auth-file` entry (default `~/.local/share/opencode/auth.json`). OAuth entries are refused so the probe cannot rotate the owner's refresh token. Without a credential, model cases report `skipped`. Each case asserts the behavior recorded here, so a changed OpenCode version fails the case whose assumption it breaks. Rerun the probe before changing the pinned OpenCode version.

## 2. What is guaranteed, observed or unknown

- **Documented by OpenCode.** The v2 [plugin guide](https://opencode.ai/v2/docs/build/plugins) documents tools with JSON Schema input, the tool `execute(input, context)` context (`sessionID`, `messageID`, `id`, `agent`, `signal`), tool `execute.before/after` hooks and the permission `evaluate` hook. It labels the plugin API **beta**. The OpenAPI document served at `/openapi.json` calls itself an "Experimental HttpApi surface". No official v2 page found during this probe documents prompt idempotency, event replay, crash recovery or interrupt guarantees.
- **Outdated reference.** Specification section 11.2 cites [opencode.ai/docs/server](https://opencode.ai/docs/server/), which documents the v1 API (`/session/:id/message`, `prompt_async`, `abort`). None of those routes match v2.
- **Observed.** Everything in section 3 comes from the probe's reproducible cases, plus the manual exploration that preceded them, against the single version above. Observed behavior is evidence for adapter design, not a contract. It can change in any release.
- **Unknown.** Section 6 lists what remains unverified.

## 3. Observed behavior

### Process, isolation and credentials

| Behavior | Evidence | Consequence |
| --- | --- | --- |
| `opencode serve --hostname 127.0.0.1 --port N` prints `server password <random>` on stdout. Every API route except `/api/info` requires HTTP basic auth `opencode:<password>`. A new password is generated on every start. | All cases | The supervisor captures the password from stdout for each runtime generation and stores it as a runtime credential. |
| `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME` and `XDG_CACHE_HOME` relocate config, the SQLite store, logs and plugin cache. They do not relocate skills: with only XDG isolation, the server loaded 78 user skills from `~/.agents/skills`. A private `HOME` removed them. | Manual, then every case | A storage namespace needs its own `HOME` and `TMPDIR` as well as XDG paths. The owner's global OpenCode config can contain production MCP servers and plaintext secrets, so isolation is a safety requirement, not a convenience. |
| CLI subcommands such as `opencode debug config` silently started a background `opencode serve --service` daemon that outlived the command. | Manual | The supervisor runs only `opencode serve` and never other CLI subcommands inside a namespace. |
| v2 ignores `auth.json`. Credentials are registered with `POST /api/credential {integrationID, value: {type: "key", key}, activate: true}` and stored in the namespace database. | All model cases | Credential provisioning is an explicit adapter operation. Backups of the harness store contain provider keys. |
| Plugins listed in `opencode.jsonc` must be directories. They load lazily after the first location boots and reload when their files change. | `structured-result-correction` | The adapter waits for `GET /api/plugin` to report the Shift plugin `active` before the first invocation. |
| SIGTERM on an idle server exits cleanly with code 130. | `idle-shutdown-resume` | Treat 130 as a clean stop. |
| `--port 0` binds a free port and prints it in the `server listening on` line. | Supervisor, 2026-10-17 | No port pre-allocation race. |
| **Tool shells inherit the server's environment** plus `OPENCODE_SESSION_ID=<session>`, `OPENCODE=1` and `AI_AGENT=opencode`. `OPENCODE_SERVER_PASSWORD` is honored, but a password supplied that way is then visible to every tool shell. A password the server generates itself is not passed to tools. | Supervisor, 2026-10-17 | Shift never supplies the password through the environment, so an agent cannot call the OpenCode API to loosen its own permissions. `OPENCODE_SESSION_ID` attributes tool processes in the runtime scope to a session. |
| Agents and plugins load lazily for each location. On the first request for a directory, `GET /api/agent` lists nothing and `GET /api/agent/build` returns `AgentNotFoundError` (404). Both appear after a second or two. A directory that does not exist returns `LocationNotFoundError`. Requests select the location with `?location[directory]=<path>`. | Supervisor, 2026-10-17 | The adapter waits until both the `build` agent and the Shift plugin are listed for a session's directory before creating sessions or submitting. |
| **Tool shell commands run in their own process group.** After SIGKILL of the server, the running `sleep … && echo done > file` kept running, was re-parented, and wrote its file. | `crash-during-tool` | Signalling the server or its process group cannot contain agent effects. The supervisor needs cgroup containment, for example a systemd scope or a cgroup v2 directory per runtime, and must kill the whole cgroup when a runtime is lost. |

### Sessions and submission

| Behavior | Evidence | Consequence |
| --- | --- | --- |
| `POST /api/session` accepts a caller-chosen `id`, `metadata`, `agent`, `model`, `location.directory` and `permissions`. Metadata is stored and returned. One server hosts many sessions, each with its own location. | `session-identity` | Use `ses_<Shift session UUID>` as the harness session ID and put Shift IDs in metadata. One runtime per Shift session is not required. |
| Creating an existing ID returns the existing session with **status 200**. New fields such as `title` are silently ignored, with no conflict signal. | `session-identity` | Creation is idempotent for reconciliation, but the adapter must compare returned agent, model, location, permissions and metadata with its intent and treat a mismatch as a blocker. |
| `POST /api/session/{id}/prompt {id, text, metadata}` returns immediately with an inbox acknowledgement echoing the supplied `msg_…` ID. The turn runs asynchronously. | `prompt-ack-and-transcript` | The acknowledgement means "accepted into the inbox", never "completed". |
| Re-submitting an existing message ID returns the originally stored message (the new text is discarded). No new user or assistant message is created and no model call is made, but an empty execution appends an extra `idle` record. | `prompt-id-dedup` | Observed deduplication, not a documented guarantee. Ignore `idle` records that have no preceding assistant output. |
| **Acknowledged but undelivered work survives SIGKILL in the inbox, but restart does not deliver it.** After restart, `GET …/message/{id}` returns 404, the inbox holds the item, and the session is not active. Re-submitting the same ID delivered it exactly once. | `crash-after-ack` | Gives a clean recovery path for "accepted, not started". |
| A prompt sent while a turn is running is queued with `delivery: "steer"`. An interrupt leaves it in the inbox, undelivered, until `DELETE /api/session/{id}/inbox/{inboxID}` removes it. | `interrupt-active-tool` | Shift serializes invocations itself, and cancellation must also delete leftover inbox items or a later turn will consume them. |
| Context survives SIGTERM, SIGKILL and restart. The session answered a question about its earlier reply after restart. | `idle-shutdown-resume`, `crash-during-tool` | `persistedSessionResume` holds for the conversation, never for interrupted operating-system processes. |

### Observation and terminal state

| Behavior | Evidence | Consequence |
| --- | --- | --- |
| `GET /api/event` is a live-only SSE stream. It sends no `id:` fields and ignores `Last-Event-ID`. Session events carry `durable: {aggregateID, seq}` with increasing `seq`. | `event-replay`, `prompt-ack-and-transcript` | Use SSE for live activity only. After any gap, reconcile from `GET /api/session/{id}/message` (paged with a cursor). `seq` can detect gaps for a session but cannot replay them. |
| The experimental `GET /api/experimental/session/{id}/log` returned only a `log.synced {seq}` marker, not history. | Manual | Not used. |
| A normal turn ends with an `idle` message: `outcome: "succeeded"` after completion, `"interrupted"` after `POST …/interrupt`. `failed` exists in the schema but was not observed. | `prompt-ack-and-transcript`, `interrupt-active-tool` | `idle` says the turn stopped, never that the node succeeded. Node success comes from the result contract. |
| Dismissing a question form ends the turn (`session.execution.interrupted` on SSE) but writes **no `idle` record**, and the session outcome stays null. The assistant message has `finish: "error"` and `error.type: "aborted"`. | `question-form` | The durable record differs between interrupt paths. Classify from assistant `finish`/`error` and tool states, not from `idle` alone. |
| **After a crash, a tool stays `running` with no `idle` record. The next prompt relabels it `error/aborted: "Tool execution interrupted"` even though its effect completed.** | `crash-during-tool` | OpenCode's post-crash "interrupted" label is not evidence about side effects. Shift must record the uncertainty before sending any further prompt to that session. |

### Structured results

| Behavior | Evidence | Consequence |
| --- | --- | --- |
| The v2 prompt API has **no output-schema or JSON-schema field**. | OpenAPI | Native structured output is unavailable. |
| A plugin tool `shift_submit_result` with `options.codemode: false` appears in the transcript as a direct tool part with its structured `input`. Throwing from `execute` produces a tool error the model sees. After a forced rejection, the model corrected itself and resubmitted within the same turn. | `structured-result-correction` | In-turn correction works without a new invocation. |
| The tool context's `sessionID`, `messageID` (the assistant message) and `id` (the tool call) matched the transcript. | `structured-result-correction` | The Shift callback can correlate each submission to the session's active invocation. |
| The `blocked` envelope with `blocker.code` worked when the input was missing. | `structured-blocker` | The fixed terminal envelope is usable as specified. |
| With code mode on, the model called the tool from generated JavaScript inside an `execute` tool, so the transcript contained only code. | Manual | The result tool must disable code mode. Other tools may still be in code mode, so tool parts are not reliable artifact evidence. |
| The agent called `shift_submit_result` unprompted in a session with no Shift invocation, and the validator rejected it. | `permission-ask` (2nd run) | Shift rejects calls when no invocation is active for the session. |

### Cancellation and tool policy

| Behavior | Evidence | Consequence |
| --- | --- | --- |
| `POST /api/session/{id}/interrupt` on a running turn returned `{interrupted: true}`, killed the tool process within the wait, marked tool and step `aborted`, and wrote `idle: interrupted`. On a crashed session with a stale tool it returned `{interrupted: false}`. | `interrupt-active-tool`, manual | Live cancellation is an acknowledged stop. After a lost runtime, cancellation is a supervisor responsibility. |
| `permissions` is a list of `{action, resource, effect}` rules. Session rules overrode agent defaults in the probed cases. The `write` tool is governed by `edit`. | `read-only-policy` | Shift can express its tool policy per session. |
| **`edit: deny` alone is not read-only.** The model wrote the file with `shell` and never tried an edit tool. | `edit-deny-shell-bypass` | A read-only profile denies both `edit` and `shell`. |
| Denying `edit` and `shell` and allowing `edit` on `<artifactDir>/*` prevented the repository write (`permission.rejected`) and allowed the artifact write. | `read-only-policy` | Matches section 6.5's artifact-directory exception. |
| An `ask` rule blocks the turn indefinitely with a `permission.asked` event and a request listing the exact commands, `save` patterns and the tool source. A `reject` reply (204) becomes a `permission.rejected` tool error and the model continues. | `permission-ask` | Asks wait invisibly unless intercepted. |
| The default `build` agent allows `question` and asks for `*.env` reads. Even the `plan` agent allows `shell`. The `question` tool creates a `form` (`metadata.kind: "question"`) that blocks the turn until it is answered or cancelled. | Manual, `question-form` | Unattended sessions must replace every `ask` with `deny` and deny `question`. |

## 4. Proposed `HarnessCapabilities` for OpenCode 2.0.26

```ts
const opencodeCapabilities: HarnessCapabilities = {
  persistedSessionResume: true, // conversation only; OS processes are never resumed
  structuredSchemaDialect: 'adapter-translated', // Shift result tool + Shift-side Ajv 2020-12
  invocationInspection: 'durable_correlated', // supplied message ID, durable inbox and messages
  cancellation: 'acknowledged_stop', // live runtime only; requires cgroup containment after a crash
  toolPolicy: 'enforced', // action-level allow/deny; not command-level sandboxing
};
```

`durable_correlated` relies on Shift's one-active-invocation rule. Only the user message carries Shift's ID. The resulting assistant messages are positional: everything after that user message up to the next `idle` record or user message.

## 5. Classifying an invocation from durable evidence

Evaluate in order. Inspection uses `GET …/message/{msgId}`, `GET …/inbox`, `GET /api/session/active`, the message list after the user message, pending permissions/forms and Shift's own record of result-tool calls.

| Classification | Evidence | Adapter action |
| --- | --- | --- |
| Not accepted | Message 404 and absent from the inbox | Safe to submit with the same ID. |
| Accepted, not delivered | Present in the inbox | Re-submit the same ID to wake delivery, or delete the inbox item to cancel. |
| Waiting on a harness prompt | Pending `permission` or `form` for the session (the session is also listed as active) | Interrupt, account for the stop, report a structured blocker. |
| Running | Session listed in `/api/session/active` | Observe. |
| Completed | Turn ended and Shift accepted a result-tool call for this invocation | Validate artifacts; node contract decides success. |
| Completed without result | Turn ended (`idle: succeeded`), no accepted result call | Contract correction invocation, per section 6.5. |
| Interrupted, accounted | `idle: interrupted`, or assistant `finish: error` with `aborted`, and no live runtime processes | Cancellation is complete. |
| Unknown | Not active, no `idle` after the message, assistant without `finish` or a tool still `running` | Record effect uncertainty before any new prompt. Continuation is a new invocation stating that prior effects are unknown. |

A result accepted by Shift's callback is authoritative even if a crash prevents OpenCode from persisting the tool's `completed` state.

## 6. Unresolved and unverified

- No v2 behavior used here is documented as guaranteed. The HTTP API is labelled experimental and the plugin API beta. Pin the exact version and rerun the probe for every upgrade.
- cgroup containment of tool processes is not implemented or tested. Without it, a lost runtime can leave agent effects running.
- The probe's result callback is unauthenticated loopback HTTP. The adapter needs a per-runtime secret, and Shift must persist each call before replying.
- Not exercised: `idle: failed`, provider errors and the assistant `retry` field, compaction on long sessions, concurrent sessions under load, session archive/delete, a crash while a permission or form is pending, a crash between Shift accepting a result and OpenCode recording it, and complex JSON Schema keywords in tool input. The envelope tool keeps `data` as a generic object and Shift validates it.
- Results depend on the model following instructions. `claude-haiku-5-5` did so in both runs. Weaker models may skip the result tool, which the contract correction path covers.
- Command-level shell policy (`shell` rules with resource patterns) was not tested beyond `*`.

## 7. Proposed specification changes

The owner approved these on 2026-10-17, with one namespace per Shift server. They are applied to the specification.

1. **Section 6.5:** replace "The harness validates a fixed Shift terminal envelope" with "Shift validates the envelope". The OpenCode adapter supplies a result-submission tool, and in-turn rejections let the agent correct a result without a new invocation. Bound in-turn rejections per invocation (proposal: 3) and keep the existing correction invocations for turns that end without an accepted result.
2. **Section 11.2:** replace "OpenCode v0 starts a managed local server per Shift session" with one supervised OpenCode runtime per storage namespace, hosting many sessions addressed by ID. Each namespace has a private `HOME`, XDG tree and `TMPDIR`, runs only `opencode serve`, and runs inside its own cgroup. Whether a namespace is per Shift server or per project remains a choice; per project isolates harness credentials and plugins but costs one process per project.
3. **Section 11.2:** replace the v1 citations with this document. Keep the conservative policy ("inspect durable messages before resubmitting") and add the observed resubmit-same-ID wake-up for undelivered work.
4. **Section 6.4 cancellation:** add that accounting for a stop includes deleting leftover inbox items and confirming the runtime cgroup has no remaining tool processes.
5. **Section 6.5 harness prompts:** unattended profiles compile every `ask` to `deny` and deny `question`. The adapter still treats any `permission.asked` or `form.created` as a blocker trigger.

## 8. Adapter work

The supervisor, adapter and policy compiler are implemented in [`apps/server/src/harness`](../apps/server/src/harness/). Session binding, durable invocation records, the in-turn rejection limit and artifact collection belong to AgentService and remain open.

- Supervisor: create the namespace tree, provision credentials over `/api/credential`, start `opencode serve` on loopback inside a systemd scope, capture the generated password, record pid, scope and generation, signal only the process it spawned, kill the scope on loss, and reap stale scopes of the namespace before every start.
- Install the Shift result plugin (directory form, `codemode: false`) into the namespace config, pointing at an authenticated Shift loopback endpoint. Wait for it to be `active`.
- `createSession`: `ses_<uuid>` plus Shift metadata, then compare returned fields with intent.
- `submit`: `msg_<invocation uuid>` with Shift metadata. A lost acknowledgement leads to the section 5 inspection, then the same-ID resubmit.
- `observe`: SSE with basic auth, normalized and redacted. Reconnect, then reconcile from messages.
- `cancel`: interrupt, wait for terminal evidence, delete leftover inbox items, check the cgroup.
- Tool policy compiler: Shift profiles to OpenCode rule lists, with read-only meaning `edit` and `shell` denied plus artifact-directory `edit` allowed.
