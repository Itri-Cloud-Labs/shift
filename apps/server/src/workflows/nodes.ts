// Registered node types (server specification sections 4.1 and 8). A published version pins each
// node's type version; a type version this server does not implement fails publication and start.
import { credentialName, type ActionPermission } from '../actions/credentials.js';
import type { Json } from '../harness/types.js';
import { githubEvents } from '../triggers/github-events.js';
import { defaultOutcomes } from './forms.js';
import { ruleDefs, ruleRef } from './rules.js';

export interface NodeTypeDefinition {
  type: string;
  version: number;
  configSchema: object;
  ports: readonly string[];
  // Ports that depend on the node's configuration, such as an approval's outcomes.
  portsFor?: (config: Json) => readonly string[];
  // Entry nodes start runs and cannot be connection targets.
  entry?: boolean;
  // Entry nodes that start runs on their own, through a subscription published with the version.
  trigger?: 'github' | 'schedule' | 'webhook';
  // Only these may return variable writes (specification 6.5).
  writesVariables?: boolean;
  // The project permission an action needs (specification 8).
  permission?: ActionPermission;
  // Authored in an explicit advanced mode rather than ordinary forms.
  advanced?: boolean;
}

const limits = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rejectedSubmissions: { type: 'integer', minimum: 1, maximum: 10 },
    corrections: { type: 'integer', minimum: 0, maximum: 5 },
    continuations: { type: 'integer', minimum: 0, maximum: 5 },
  },
};
const schema = { anyOf: [{ type: 'object' }, { type: 'boolean' }] };
const envName = { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]{0,127}$' };
const headerName = { type: 'string', pattern: "^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$" };
const credentialRef = { type: 'string', pattern: credentialName.source };
// A pull request number, or a `{{binding}}` that resolves to one when the step runs.
const prNumber = { type: 'string', minLength: 1, maxLength: 200 };
const branchText = { type: 'string', minLength: 1, maxLength: 250 };
// A full commit SHA, or a `{{binding}}` that resolves to one.
const commitText = { type: 'string', minLength: 1, maxLength: 200 };
const checkNames = {
  type: 'array',
  maxItems: 50,
  uniqueItems: true,
  items: { type: 'string', minLength: 1, maxLength: 200 },
};
const variableKey = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' };
const requirement = { enum: ['required', 'optional', 'off'] };
const interaction = {
  title: { type: 'string', minLength: 1, maxLength: 200 },
  instructions: { type: 'string', maxLength: 20000 },
  timeoutMs: { type: 'integer', minimum: 1000, maximum: 366 * 24 * 60 * 60 * 1000 },
};

export const nodeTypes: readonly NodeTypeDefinition[] = [
  {
    type: 'manual_trigger',
    version: 1,
    entry: true,
    ports: ['success'],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { inputSchema: schema },
    },
  },
  {
    // Starts a run for each matching verified delivery from the project's GitHub repository.
    type: 'github_trigger',
    version: 1,
    entry: true,
    trigger: 'github',
    ports: ['success'],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['event'],
      properties: {
        event: { enum: Object.keys(githubEvents) },
        actions: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          uniqueItems: true,
          items: { type: 'string', pattern: '^[a-z_]{1,50}$' },
        },
        branches: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          uniqueItems: true,
          items: branchText,
        },
      },
    },
  },
  {
    // Builds new data from a JSON template: `{"$binding": "<name>"}` is replaced by that binding.
    type: 'transform',
    version: 1,
    ports: ['success', 'error'],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['data'],
      properties: { data: {} },
    },
  },
  {
    // `{{name}}` in the goal is replaced by the binding's value; non-strings render as JSON.
    type: 'agent',
    version: 1,
    ports: ['success', 'error'],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['goal'],
      properties: {
        goal: { type: 'string', minLength: 1, maxLength: 20000 },
        model: { type: 'string', pattern: '^[^/\\s]+/\\S+$', maxLength: 200 },
        readOnly: { type: 'boolean' },
        resultSchema: schema,
        limits,
        // Which conversation the agent works in (specification 6.4): a new one per execution, one
        // per run and node reused on later visits, or an explicitly chosen project session.
        session: {
          type: 'object',
          additionalProperties: false,
          properties: {
            strategy: { enum: ['fresh', 'per_run', 'reference'] },
            lifetime: { enum: ['persistent', 'ephemeral'] },
            reference: {
              type: 'string',
              pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
            },
          },
        },
        // Which reports a completed result needs (specification 6.5). Both are required by default.
        reports: {
          type: 'object',
          additionalProperties: false,
          properties: { handoff: requirement, humanReport: requirement },
        },
        // Which earlier handoffs the agent reads: the one that came in (default yes), and those of
        // named earlier agents. An independent reviewer can receive none.
        handoffs: {
          type: 'object',
          additionalProperties: false,
          properties: {
            incoming: { type: 'boolean' },
            nodes: {
              type: 'array',
              maxItems: 20,
              uniqueItems: true,
              items: { type: 'string', minLength: 1, maxLength: 100 },
            },
          },
        },
      },
    },
  },
  {
    // Waits for `durationMs` or until `until`, an ISO 8601 time with an offset that may use
    // `{{name}}` bindings, then passes its input through. The deadline is fixed when it starts.
    type: 'wait',
    version: 1,
    ports: ['success', 'error'],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        durationMs: { type: 'integer', minimum: 0, maximum: 366 * 24 * 60 * 60 * 1000 },
        until: { type: 'string', minLength: 1, maxLength: 200 },
      },
    },
  },
  {
    // Selects `true` or `false` from `when` and passes its input through.
    type: 'condition',
    version: 1,
    ports: ['true', 'false', 'error'],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['when'],
      properties: { when: ruleRef },
      $defs: ruleDefs,
    },
  },
  {
    // Selects the port of the first case whose rule holds, or `default`, and passes its input
    // through. Each case's `port` is an output port.
    type: 'switch',
    version: 1,
    ports: ['default', 'error'],
    portsFor: (config) => [
      ...((config as { cases?: Array<{ port: string }> } | null)?.cases ?? []).map(
        (entry) => entry.port,
      ),
      'default',
      'error',
    ],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['cases'],
      properties: {
        cases: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['port', 'when'],
            properties: {
              port: {
                type: 'string',
                pattern: '^[a-z][a-z0-9_]{0,39}$',
                not: { enum: ['default', 'error'] },
              },
              when: ruleRef,
            },
          },
        },
      },
      $defs: ruleDefs,
    },
  },
  {
    // Asks the owner to fill in `form`. `title` and `instructions` may use `{{name}}` bindings.
    type: 'human_input',
    version: 1,
    ports: ['success', 'timeout', 'error'],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'form'],
      properties: { ...interaction, form: { type: 'object' } },
    },
  },
  {
    // Asks the owner to choose one of `outcomes`, each an output port, with an optional form.
    type: 'approval',
    version: 1,
    ports: [...defaultOutcomes, 'timeout', 'error'],
    portsFor: (config) => [
      ...((config as { outcomes?: string[] } | null)?.outcomes ?? defaultOutcomes),
      'timeout',
      'error',
    ],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['title'],
      properties: {
        ...interaction,
        form: { type: 'object' },
        outcomes: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          uniqueItems: true,
          items: {
            type: 'string',
            pattern: '^[a-z][a-z0-9_]{0,39}$',
            not: { enum: ['timeout', 'error'] },
          },
        },
      },
    },
  },
  {
    // Writes `value`, a Transform template, to the run variable `key`. The write commits with the
    // node's completion; the node passes its input through.
    type: 'set_variable',
    version: 1,
    ports: ['success', 'error'],
    writesVariables: true,
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'value'],
      properties: { key: variableKey, value: {} },
    },
  },
  {
    // Publishes the current value of the run variable `key` as its data, read once when the
    // execution is prepared. An optional variable that was never written uses `fallback`.
    type: 'get_variable',
    version: 1,
    ports: ['success', 'error'],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['key'],
      properties: { key: variableKey, optional: { type: 'boolean' }, fallback: {} },
    },
  },
  {
    // Runs an executable with an argument array, or a script under /bin/sh in explicit shell
    // mode, in the run workspace. `{{name}}` bindings fill arguments and environment values, never
    // the shell script, which reads them from the environment instead.
    type: 'command',
    version: 1,
    ports: ['success', 'error'],
    permission: 'command',
    configSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: { enum: ['exec', 'shell'] },
        executable: { type: 'string', minLength: 1, maxLength: 4096 },
        args: { type: 'array', maxItems: 200, items: { type: 'string', maxLength: 16384 } },
        script: { type: 'string', minLength: 1, maxLength: 65536 },
        cwd: { type: 'string', minLength: 1, maxLength: 1024 },
        env: {
          type: 'object',
          maxProperties: 50,
          propertyNames: envName,
          additionalProperties: { type: 'string', maxLength: 16384 },
        },
        credentials: {
          type: 'object',
          maxProperties: 20,
          propertyNames: envName,
          additionalProperties: credentialRef,
        },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 24 * 60 * 60 * 1000 },
        maxOutputBytes: { type: 'integer', minimum: 1024, maximum: 256 * 1024 },
        parseJson: { type: 'boolean' },
        safeToRetry: { type: 'boolean' },
      },
    },
  },
  {
    // Sends one HTTP request. `{{name}}` bindings fill the URL, header values and a text body; a
    // JSON body is a Transform template. Credential headers are injected when the request is sent.
    type: 'http',
    version: 1,
    ports: ['success', 'error'],
    permission: 'http',
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        method: { enum: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        url: { type: 'string', minLength: 1, maxLength: 8192 },
        headers: {
          type: 'object',
          maxProperties: 50,
          propertyNames: headerName,
          additionalProperties: { type: 'string', maxLength: 8192 },
        },
        credentialHeaders: {
          type: 'object',
          maxProperties: 10,
          propertyNames: headerName,
          additionalProperties: {
            type: 'object',
            additionalProperties: false,
            required: ['credential'],
            properties: {
              credential: credentialRef,
              prefix: { type: 'string', maxLength: 100, pattern: '^[^\\r\\n]*$' },
            },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: {
            kind: { enum: ['json', 'text'] },
            value: {},
            text: { type: 'string', maxLength: 1024 * 1024 },
            contentType: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 10 * 60 * 1000 },
        maxResponseBytes: { type: 'integer', minimum: 1024, maximum: 1024 * 1024 },
        responseSchema: schema,
        followRedirects: { type: 'boolean' },
        safeToRetry: { type: 'boolean' },
      },
    },
  },
  {
    // Advanced: the body of an async JavaScript function `(input, bindings)` returning JSON, run
    // in a bounded child process with no credentials, files or engine objects.
    type: 'script',
    version: 1,
    ports: ['success', 'error'],
    permission: 'script',
    advanced: true,
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['source'],
      properties: {
        source: { type: 'string', minLength: 1, maxLength: 100_000 },
        timeoutMs: { type: 'integer', minimum: 100, maximum: 5 * 60 * 1000 },
        resultSchema: schema,
        safeToRetry: { type: 'boolean' },
      },
    },
  },
  {
    // Observes the run workspace: HEAD, branch and changed paths. Every run is a fresh look.
    type: 'git_status',
    version: 1,
    ports: ['success', 'error'],
    permission: 'git',
    configSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { maxEntries: { type: 'integer', minimum: 1, maximum: 10000 } },
    },
  },
  {
    // The workspace's changes against the run's base commit or HEAD, as text and per file.
    type: 'git_diff',
    version: 1,
    ports: ['success', 'error'],
    permission: 'git',
    configSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        against: { enum: ['base', 'head'] },
        paths: {
          type: 'array',
          maxItems: 100,
          items: { type: 'string', minLength: 1, maxLength: 1024 },
        },
        maxBytes: { type: 'integer', minimum: 1024, maximum: 1024 * 1024 },
      },
    },
  },
  {
    // Names the workspace's current commit, keeping its changes. `{{name}}` bindings fill it.
    type: 'git_create_branch',
    version: 1,
    ports: ['success', 'error'],
    permission: 'git',
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: { name: { type: 'string', minLength: 1, maxLength: 250 } },
    },
  },
  {
    // Commits every change in the workspace with `message`, which `{{name}}` bindings fill.
    type: 'git_commit',
    version: 1,
    ports: ['success', 'error'],
    permission: 'git',
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: {
        message: { type: 'string', minLength: 1, maxLength: 20000 },
        allowEmpty: { type: 'boolean' },
      },
    },
  },
  {
    // Pushes a local branch, the current one by default, to `remote` (default origin).
    type: 'git_push',
    version: 1,
    ports: ['success', 'error'],
    permission: 'git_push',
    configSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        remote: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$' },
        branch: { type: 'string', minLength: 1, maxLength: 250 },
        remoteBranch: { type: 'string', minLength: 1, maxLength: 250 },
        // `github_app` pushes to the project's GitHub repository with the App's token.
        transport: { enum: ['host', 'github_app'] },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 60 * 60 * 1000 },
      },
    },
  },
  {
    // Reads a pull request of the project's GitHub repository, by number or head branch.
    type: 'github_get_pr',
    version: 1,
    ports: ['success', 'error'],
    permission: 'github',
    configSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { number: prNumber, head: branchText },
      oneOf: [
        { required: ['number'], properties: { number: prNumber } },
        { required: ['head'], properties: { head: branchText } },
      ],
    },
  },
  {
    type: 'github_create_pr',
    version: 1,
    ports: ['success', 'error'],
    permission: 'github',
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['head', 'title'],
      properties: {
        head: branchText,
        // The repository's default branch when absent.
        base: branchText,
        title: { type: 'string', minLength: 1, maxLength: 1000 },
        body: { type: 'string', maxLength: 60000 },
        draft: { type: 'boolean' },
      },
    },
  },
  {
    type: 'github_update_pr',
    version: 1,
    ports: ['success', 'error'],
    permission: 'github',
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['number'],
      minProperties: 2,
      properties: {
        number: prNumber,
        title: { type: 'string', minLength: 1, maxLength: 1000 },
        body: { type: 'string', maxLength: 60000 },
        base: branchText,
        state: { enum: ['open', 'closed'] },
      },
    },
  },
  {
    // Reads the checks of one commit now; the author routes on `state` with a Condition or Switch.
    type: 'github_verify_checks',
    version: 1,
    ports: ['success', 'error'],
    permission: 'github',
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['commit'],
      properties: { commit: commitText, checks: checkNames },
    },
  },
  {
    // Polls the checks of one commit durably until they pass, one fails, or the deadline.
    type: 'github_wait_checks',
    version: 1,
    ports: ['success', 'failure', 'timeout', 'error'],
    permission: 'github',
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['commit'],
      properties: {
        commit: commitText,
        checks: checkNames,
        timeoutMs: { type: 'integer', minimum: 60_000, maximum: 7 * 24 * 60 * 60 * 1000 },
        intervalMs: { type: 'integer', minimum: 5_000, maximum: 60 * 60 * 1000 },
      },
    },
  },
  {
    // Merges when reached. Checks, reviews and waits are the author's own nodes before it.
    type: 'github_merge',
    version: 1,
    ports: ['success', 'error'],
    permission: 'github',
    configSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['number'],
      properties: {
        number: prNumber,
        method: { enum: ['merge', 'squash', 'rebase'] },
        // Only when set: GitHub refuses the merge if the head is another commit.
        expectedCommit: commitText,
        commitTitle: { type: 'string', minLength: 1, maxLength: 1000 },
        commitMessage: { type: 'string', maxLength: 60000 },
      },
    },
  },
  {
    type: 'end',
    version: 1,
    ports: [],
    configSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        outcome: { enum: ['COMPLETED', 'FAILED'] },
        reason: { type: 'string', maxLength: 4000 },
      },
    },
  },
];

export function nodeType(type: string, version: number): NodeTypeDefinition | undefined {
  return nodeTypes.find((candidate) => candidate.type === type && candidate.version === version);
}
