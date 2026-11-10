import { CircleAlert, Copy, GitCompareArrows, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useEscape } from './Attention.js';
import {
  BindingsBuilder,
  CasesBuilder,
  DataBuilder,
  RuleBuilder,
  SchemaBuilder,
  Fallback,
  TemplateValue,
  VariableKey,
  type BindingEditing,
} from './Builders.js';
import { unknownConfig, withMethod } from './config.js';
import { addableTypes, advancedTypes, type DraftProblem } from './draft.js';
import { TextField, Typing } from './Fields.js';
import { outputPorts, typeLabels, type DocumentNode, type GraphDocument } from './graph.js';
import { TypeIcon } from './icons.js';
import {
  Check,
  CredentialRefs,
  LinesField,
  MethodSelect,
  NumberField,
  PairsField,
  SafeToRetry,
} from './Actions.js';
import { AgentSessionFields, Select } from './Sessions.js';

// The draft editor's islands: choosing a node type, the problems list, a save conflict, and the
// form for the selected node.

const typeHints: Record<string, string> = {
  manual_trigger: 'Where a run starts',
  transform: 'Builds new data',
  agent: 'Works in the repository',
  condition: 'Takes one of two paths',
  switch: 'Takes one of several paths',
  wait: 'Pauses for a while',
  human_input: 'Asks you to fill in a form',
  approval: 'Asks you to decide',
  set_variable: 'Remembers a value for this run',
  get_variable: 'Reads a value this run remembered',
  command: 'Runs a program in the workspace',
  http: 'Sends a web request',
  script: 'Computes data with JavaScript',
  git_status: 'Looks at the workspace’s changes',
  git_diff: 'Shows what changed',
  git_create_branch: 'Names the work as a branch',
  git_commit: 'Records the changes',
  git_push: 'Publishes the branch',
  github_get_pr: 'Reads a pull request',
  github_create_pr: 'Opens a pull request',
  github_update_pr: 'Changes a pull request',
  github_verify_checks: 'Reads a commit’s checks once',
  github_wait_checks: 'Waits until a commit’s checks finish',
  github_merge: 'Merges a pull request',
  end: 'Finishes the run',
};

export function NodePicker({
  hasTrigger,
  choose,
  close,
}: {
  hasTrigger: boolean;
  choose: (type: string) => void;
  close: () => void;
}) {
  useEscape(close);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const types = addableTypes.filter((type) => type !== 'manual_trigger' || !hasTrigger);
  return (
    <>
      <div className="scrim clear" onPointerDown={close} />
      <section className="island node-picker" role="dialog" aria-label="Add a node">
        <h2>Add a node</h2>
        <ul>
          {types.map((type, index) => (
            <li key={type}>
              <button
                ref={index === 0 ? first : undefined}
                className="option"
                onClick={() => choose(type)}
              >
                <TypeIcon type={type} />
                <span className="name">{typeLabels[type]}</span>
                <span className="note">{typeHints[type]}</span>
              </button>
            </li>
          ))}
        </ul>
        <details className="advanced-types">
          <summary>Advanced</summary>
          <p className="note">Code you write, run on the server as your account.</p>
          <ul>
            {advancedTypes.map((type) => (
              <li key={type}>
                <button className="option" onClick={() => choose(type)}>
                  <TypeIcon type={type} />
                  <span className="name">{typeLabels[type]}</span>
                  <span className="note">{typeHints[type]}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      </section>
    </>
  );
}

export function ProblemsPanel({
  problems,
  select,
  close,
}: {
  problems: DraftProblem[];
  select: (nodeId: string) => void;
  close: () => void;
}) {
  return (
    <aside className="island problems" aria-label="Problems">
      <header>
        <h2>Problems</h2>
        <button className="button quiet icon" aria-label="Close problems" onClick={close}>
          <X />
        </button>
      </header>
      {problems.length === 0 ? (
        <p className="note">Nothing found. The server checks everything again when you publish.</p>
      ) : (
        <ul>
          {problems.map((problem, index) => (
            <li key={index}>
              <button
                className="problem"
                disabled={!problem.nodeId}
                onClick={() => problem.nodeId && select(problem.nodeId)}
              >
                <span
                  className="status"
                  data-status={problem.severity === 'error' ? 'failed' : 'waiting'}
                >
                  {problem.severity === 'error' ? (
                    <CircleAlert aria-hidden="true" />
                  ) : (
                    <TriangleAlert aria-hidden="true" />
                  )}
                  <span className="visually-hidden">
                    {problem.severity === 'error' ? 'Error: ' : 'Warning: '}
                  </span>
                </span>
                <span>{problem.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

// Another device saved while edits were open. Both versions stay until the owner chooses.
export function ConflictIsland({
  revision,
  mine,
  theirs,
  keepMine,
  takeTheirs,
}: {
  revision: number;
  mine: GraphDocument;
  theirs: GraphDocument;
  keepMine: () => void;
  takeTheirs: () => void;
}) {
  const ids = (document: GraphDocument) => new Set(document.nodes.map((node) => node.id));
  const [mineIds, theirIds] = [ids(mine), ids(theirs)];
  const onlyMine = [...mineIds].filter((id) => !theirIds.has(id));
  const onlyTheirs = [...theirIds].filter((id) => !mineIds.has(id));
  return (
    <section
      className="island conflict"
      role="alertdialog"
      aria-label="This draft changed elsewhere"
    >
      <h2>
        <GitCompareArrows aria-hidden="true" />
        This draft changed elsewhere
      </h2>
      <p>
        Another device saved revision {revision} while you were editing. Nothing has been
        overwritten: your edits are still here, and theirs are safe on the server.
      </p>
      <dl>
        <dt>Your version</dt>
        <dd>
          {mine.nodes.length} nodes, {mine.connections.length} connections
          {onlyMine.length > 0 && `. Only here: ${onlyMine.join(', ')}`}
        </dd>
        <dt>Their version</dt>
        <dd>
          {theirs.nodes.length} nodes, {theirs.connections.length} connections
          {onlyTheirs.length > 0 && `. Only there: ${onlyTheirs.join(', ')}`}
        </dd>
      </dl>
      <div className="actions">
        <button className="button" onClick={takeTheirs}>
          Discard mine, use theirs
        </button>
        <button className="button primary" onClick={keepMine}>
          Keep mine, then save over theirs
        </button>
      </div>
    </section>
  );
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const templated = new Set([
  'goal',
  'title',
  'instructions',
  'until',
  'url',
  'name',
  'message',
  'branch',
  'remoteBranch',
  'number',
  'head',
  'base',
  'body',
  'commit',
  'expectedCommit',
  'commitTitle',
  'commitMessage',
]);

function GitHubNote() {
  return (
    <p className="note">
      Uses the GitHub repository connected to this project in Settings › Projects.
    </p>
  );
}

function TokenPicker({
  id,
  label,
  bindings,
  insert,
}: {
  id: string;
  label: string;
  bindings: string[];
  insert: (token: string) => void;
}) {
  return (
    <div className="field token-picker">
      <label className="visually-hidden" htmlFor={`${id}-token`}>
        Insert a value into {label}
      </label>
      <select
        id={`${id}-token`}
        value=""
        onChange={(event) => event.target.value && insert(`{{${event.target.value}}}`)}
      >
        <option value="">Insert a value…</option>
        {bindings.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}

// How often a node is tried, and how often one run may reach it (server specification 6.5).
const retryDefaults = { maxAttempts: 1, initialDelayMs: 1000, maxDelayMs: 60000 };

function RetryFields({
  node,
  problem,
  setNode,
}: {
  node: DocumentNode;
  problem?: string | undefined;
  setNode: (key: 'retry' | 'limits', value: unknown) => void;
}) {
  const retry = { ...retryDefaults, ...(node.retry ?? {}) } as Record<string, unknown>;
  const limits = { maxExecutionsPerRun: 50, ...(node.limits ?? {}) } as Record<string, unknown>;
  const number = (value: unknown) => (typeof value === 'number' ? value : 0);
  const whole = (value: string, scale = 1) => {
    const parsed = Number(value);
    return value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0
      ? Math.round(parsed * scale)
      : undefined;
  };
  // The server requires all three retry fields, so a change writes them together.
  const retryField = (key: string, label: string, scale: number) => (
    <TextField
      id={`${node.id}-retry-${key}`}
      label={label}
      numeric
      value={String(number(retry[key]) / scale)}
      commit={(value) => {
        const next = whole(value, scale);
        if (next !== undefined) setNode('retry', { ...retry, [key]: next });
      }}
    />
  );
  return (
    <details className="field-group retry">
      <summary>Retries and limits</summary>
      {retryField('maxAttempts', 'Attempts before it fails (1 to 100)', 1)}
      <div className="builder-pair">
        {retryField('initialDelayMs', 'First wait (seconds)', 1000)}
        {retryField('maxDelayMs', 'Longest wait (seconds)', 1000)}
      </div>
      {problem && <p className="field-error">{problem}</p>}
      <TextField
        id={`${node.id}-limits-executions`}
        label="Times one run may reach it (1 to 10,000)"
        numeric
        value={String(number(limits['maxExecutionsPerRun']))}
        note="Stops a loop that does not end."
        commit={(value) => {
          const next = whole(value);
          if (next !== undefined) setNode('limits', { ...limits, maxExecutionsPerRun: next });
        }}
      />
    </details>
  );
}

// What this app has no form for: kept exactly, and shown so it does not seem to disappear.
function Advanced({ node }: { node: DocumentNode }) {
  const hidden = { ...unknownConfig(node.type, node.config), ...(node.extra ?? {}) };
  if (Object.keys(hidden).length === 0) return null;
  return (
    <details className="field-group advanced">
      <summary>Advanced: kept as it is</summary>
      <p className="note">
        This app has no form for these. They are saved as they are; the server checks them when you
        publish.
      </p>
      <pre>{JSON.stringify(hidden, null, 2)}</pre>
    </details>
  );
}
const seconds = (value: unknown) => (typeof value === 'number' ? String(value / 1000) : '');

// The form for each node type. Whatever a form does not show is kept as it came.
function ConfigFields({
  node,
  document,
  projectId,
  problems,
  set,
  replace,
  renameCase,
}: {
  node: DocumentNode;
  document: GraphDocument;
  projectId: string | null;
  problems: DraftProblem[];
  set: (key: string, value: unknown) => void;
  // Replaces the whole config in one edit, for settings that change together.
  replace: (config: Record<string, unknown>) => void;
  renameCase: (index: number, next: string) => string | null;
}) {
  const { config, id } = node;
  const problem = (field: string) => problems.find((item) => item.field === field)?.message;
  const string = (key: string, value: string) => set(key, value === '' ? undefined : value);
  const ms = (key: string, value: string) => {
    const number = Number(value);
    set(
      key,
      value === '' || !Number.isFinite(number) || number < 0
        ? undefined
        : Math.round(number * 1000),
    );
  };
  const bindings = Object.keys(node.bindings);
  // Templated text names a value as {{name}}; the picker inserts exactly that at the cursor.
  const field = (key: string, label: string, multiline = false, note?: string) => (
    <>
      <TextField
        id={`${id}-${key}`}
        label={label}
        value={text(config[key])}
        multiline={multiline}
        note={note}
        problem={problem(key)}
        commit={(value) => string(key, value)}
      />
      {templated.has(key) && bindings.length > 0 && (
        <TokenPicker
          id={`${id}-${key}`}
          label={label}
          bindings={bindings}
          insert={(token) => {
            const element = window.document.getElementById(`${id}-${key}`) as
              HTMLInputElement | HTMLTextAreaElement | null;
            const current = element?.value ?? text(config[key]);
            const start = element?.selectionStart ?? current.length;
            const end = element?.selectionEnd ?? start;
            string(key, current.slice(0, start) + token + current.slice(end));
          }}
        />
      )}
    </>
  );
  const timeout = (
    <TextField
      id={`${id}-timeout`}
      label="Time out after (seconds, optional)"
      numeric
      value={seconds(config['timeoutMs'])}
      commit={(value) => ms('timeoutMs', value)}
    />
  );
  switch (node.type) {
    case 'manual_trigger':
      return (
        <SchemaBuilder
          id={`${id}-input`}
          legend="Input a run asks for"
          empty="A run starts without asking for anything."
          schema={config['inputSchema']}
          set={(schema) => set('inputSchema', schema)}
        />
      );
    case 'transform':
      return (
        <DataBuilder node={node} problem={problem('data')} set={(data) => set('data', data)} />
      );
    case 'condition':
      return (
        <fieldset className="field-group">
          <legend>Takes the true port when</legend>
          <RuleBuilder
            id={`${id}-when`}
            rule={config['when']}
            bindings={Object.keys(node.bindings)}
            problem={problem('when')}
            change={(when) => set('when', when)}
          />
        </fieldset>
      );
    case 'switch':
      return <CasesBuilder node={node} set={(cases) => set('cases', cases)} rename={renameCase} />;
    case 'agent':
      return (
        <>
          {field('goal', 'Goal', true, 'What the agent should do. Use {{name}} for a binding.')}
          {field('model', 'Model (optional)', false, 'As OpenCode names it: provider/model.')}
          <AgentSessionFields
            id={id}
            config={config}
            projectId={projectId}
            agents={document.nodes
              .filter((item) => item.type === 'agent' && item.id !== id)
              .map((item) => item.id)}
            set={set}
          />
          {(problem('session') || problem('handoffs')) && (
            <p className="field-error">{problem('session') ?? problem('handoffs')}</p>
          )}
          <div className="field">
            <label className="field-check">
              <input
                type="checkbox"
                checked={config['readOnly'] === true}
                onChange={(event) => set('readOnly', event.target.checked ? true : undefined)}
              />
              Read only: no file edits or shell commands
            </label>
          </div>
          <SchemaBuilder
            id={`${id}-result`}
            legend="Result it must return"
            empty="The agent may return anything."
            schema={config['resultSchema']}
            set={(schema) => set('resultSchema', schema)}
          />
          <fieldset className="field-group">
            <legend>When its result is not accepted</legend>
            {(
              [
                ['corrections', 'Corrections it may make (0 to 5)'],
                ['rejectedSubmissions', 'Rejected results before it fails (1 to 10)'],
                ['continuations', 'Continuations it may ask for (0 to 5)'],
              ] as const
            ).map(([key, label]) => (
              <TextField
                key={key}
                id={`${id}-limits-${key}`}
                label={label}
                numeric
                value={
                  typeof (config['limits'] as Record<string, unknown> | undefined)?.[key] ===
                  'number'
                    ? String((config['limits'] as Record<string, number>)[key])
                    : ''
                }
                commit={(value) => {
                  const { [key]: _old, ...rest } = (config['limits'] ?? {}) as Record<
                    string,
                    unknown
                  >;
                  const number = Number(value);
                  const next =
                    value.trim() === '' || !Number.isInteger(number)
                      ? rest
                      : { ...rest, [key]: number };
                  set('limits', Object.keys(next).length ? next : undefined);
                }}
              />
            ))}
            <p className="note">Empty uses the server’s default.</p>
          </fieldset>
        </>
      );
    case 'wait':
      return (
        <>
          <TextField
            id={`${id}-duration`}
            label="Wait for (seconds)"
            numeric
            value={seconds(config['durationMs'])}
            problem={problem('durationMs')}
            note="Use this or a time, not both."
            commit={(value) => ms('durationMs', value)}
          />
          {field('until', 'Or wait until', false, 'With an offset: 2026-11-01T09:00:00Z.')}
        </>
      );
    case 'human_input':
      return (
        <>
          {field('title', 'Title')}
          {field('instructions', 'Instructions (optional)', true)}
          {timeout}
          <SchemaBuilder
            id={`${id}-form`}
            legend="Form to fill in"
            empty="The form has no fields yet."
            schema={config['form']}
            form
            keepEmpty
            problem={problem('form')}
            set={(schema) => set('form', schema)}
          />
        </>
      );
    case 'approval':
      return (
        <>
          {field('title', 'Title')}
          {field('instructions', 'Instructions (optional)', true)}
          <TextField
            id={`${id}-outcomes`}
            label="Outcomes"
            value={
              Array.isArray(config['outcomes']) ? (config['outcomes'] as string[]).join(', ') : ''
            }
            placeholder="approved, rejected"
            note="Separated by commas. Each one becomes a port."
            commit={(value) => {
              const list = value
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
              set('outcomes', list.length ? [...new Set(list)] : undefined);
            }}
          />
          {timeout}
          <SchemaBuilder
            id={`${id}-form`}
            legend="Form beside the decision"
            empty="It asks for an optional comment."
            schema={config['form']}
            form
            problem={problem('form')}
            set={(schema) => set('form', schema)}
          />
        </>
      );
    case 'set_variable':
      return (
        <>
          <VariableKey
            id={`${id}-key`}
            value={text(config['key'])}
            document={document}
            problem={problem('key')}
            set={(key) => set('key', key)}
          />
          <fieldset className="field-group">
            <legend>Value it writes</legend>
            {config['value'] !== undefined ? (
              <TemplateValue
                id={`${id}-value`}
                value={config['value']}
                bindings={bindings}
                set={(value) => set('value', value)}
              />
            ) : (
              <button type="button" className="button quiet" onClick={() => set('value', 0)}>
                <Plus aria-hidden="true" />
                Add a value
              </button>
            )}
            {problem('value') && <p className="field-error">{problem('value')}</p>}
            <p className="note">
              Nodes that run after it read the new value. It passes on what came in unchanged.
            </p>
          </fieldset>
        </>
      );
    case 'get_variable':
      return (
        <>
          <VariableKey
            id={`${id}-key`}
            value={text(config['key'])}
            document={document}
            problem={problem('key')}
            set={(key) => set('key', key)}
          />
          <Fallback id={id} source={config} set={replace} />
          <p className="note">Its result is the variable’s value when it starts.</p>
        </>
      );
    case 'command': {
      const shell = config['mode'] === 'shell';
      return (
        <>
          <Select
            id={`${id}-mode`}
            label="Runs"
            value={shell ? 'shell' : 'exec'}
            options={[
              ['exec', 'A program with arguments'],
              ['shell', 'A shell script (/bin/sh)'],
            ]}
            change={(next) =>
              replace(
                next === 'shell'
                  ? {
                      ...Object.fromEntries(
                        Object.entries(config).filter(
                          ([key]) => !['executable', 'args'].includes(key),
                        ),
                      ),
                      mode: 'shell',
                      script: text(config['script']) || '',
                    }
                  : {
                      ...Object.fromEntries(
                        Object.entries(config).filter(([key]) => !['mode', 'script'].includes(key)),
                      ),
                      executable: text(config['executable']),
                    },
              )
            }
          />
          {shell ? (
            <TextField
              id={`${id}-script`}
              label="Script"
              multiline
              value={text(config['script'])}
              problem={problem('script')}
              note="Read values as environment variables, such as $NAME. Values never fill the script itself."
              commit={(value) => string('script', value)}
            />
          ) : (
            <>
              <TextField
                id={`${id}-executable`}
                label="Program"
                value={text(config['executable'])}
                placeholder="pnpm"
                problem={problem('executable')}
                commit={(value) => set('executable', value)}
              />
              <LinesField
                id={`${id}-args`}
                label="Arguments, one per line"
                value={config['args']}
                note="Each line is one argument, never split or read by a shell. Use {{name}} for a value."
                commit={(args) => set('args', args)}
              />
            </>
          )}
          <TextField
            id={`${id}-cwd`}
            label="Folder (optional)"
            value={text(config['cwd'])}
            placeholder="."
            problem={problem('cwd')}
            note="Inside the run’s workspace."
            commit={(value) => string('cwd', value)}
          />
          <PairsField
            id={`${id}-env`}
            label="Environment, one NAME=value per line"
            separator="="
            value={config['env']}
            note="Values can use {{name}}."
            commit={(env) => set('env', env)}
          />
          <CredentialRefs
            id={`${id}-credentials`}
            legend="Credentials as environment variables"
            target="Variable"
            projectId={projectId}
            value={config['credentials']}
            commit={(refs) => set('credentials', refs)}
          />
          {timeout}
          <NumberField
            id={`${id}-output`}
            label="Output kept per stream (KiB, optional)"
            value={config['maxOutputBytes']}
            scale={1024}
            note="The end of the output is kept. Default 64, at most 256."
            set={(value) => set('maxOutputBytes', value)}
          />
          <Check
            label="Read the output as JSON"
            checked={config['parseJson'] === true}
            change={(checked) => set('parseJson', checked ? true : undefined)}
          />
          <SafeToRetry config={config} set={set} />
        </>
      );
    }
    case 'http': {
      const body = (config['body'] ?? null) as {
        kind?: string;
        value?: unknown;
        text?: string;
      } | null;
      const method = typeof config['method'] === 'string' ? config['method'] : 'GET';
      return (
        <>
          <MethodSelect
            id={`${id}-method`}
            value={config['method']}
            set={(value) => replace(withMethod(config, value))}
          />
          {field('url', 'URL', false, 'A full address. Use {{name}} for a value.')}
          <PairsField
            id={`${id}-headers`}
            label="Headers, one Name: value per line"
            separator=":"
            value={config['headers']}
            commit={(headers) => set('headers', headers)}
          />
          <CredentialRefs
            id={`${id}-credential-headers`}
            legend="Credentials as headers"
            target="Header"
            prefix
            projectId={projectId}
            value={config['credentialHeaders']}
            commit={(refs) => set('credentialHeaders', refs)}
          />
          {!['GET', 'HEAD', 'OPTIONS'].includes(method) && (
            <fieldset className="field-group">
              <legend>Body</legend>
              <Select
                id={`${id}-body-kind`}
                label="Sends"
                value={body?.kind ?? 'none'}
                options={[
                  ['none', 'No body'],
                  ['json', 'JSON built from values'],
                  ['text', 'Text'],
                ]}
                change={(kind) =>
                  set(
                    'body',
                    kind === 'json'
                      ? { kind, value: {} }
                      : kind === 'text'
                        ? { kind, text: '' }
                        : undefined,
                  )
                }
              />
              {body?.kind === 'json' && (
                <TemplateValue
                  id={`${id}-body`}
                  value={body.value}
                  bindings={bindings}
                  set={(value) => set('body', { ...body, value })}
                />
              )}
              {body?.kind === 'text' && (
                <TextField
                  id={`${id}-body-text`}
                  label="Text"
                  multiline
                  value={text(body.text)}
                  note="Use {{name}} for a value."
                  commit={(value) => set('body', { ...body, text: value })}
                />
              )}
            </fieldset>
          )}
          {problem('body') && <p className="field-error">{problem('body')}</p>}
          <SchemaBuilder
            id={`${id}-response`}
            legend="Response it must return"
            empty="Any response body is accepted."
            schema={config['responseSchema']}
            set={(schema) => set('responseSchema', schema)}
          />
          {timeout}
          <Check
            label="Follow redirects"
            checked={config['followRedirects'] === true}
            change={(checked) => set('followRedirects', checked ? true : undefined)}
          />
          {!['GET', 'HEAD', 'OPTIONS'].includes(method) && (
            <SafeToRetry config={config} set={set} />
          )}
        </>
      );
    }
    case 'script':
      return (
        <>
          <p className="note warning-note">
            Advanced: JavaScript you write, run on the server in its own process. It gets the
            input’s data as <code>input</code> and the bindings as <code>bindings</code>, no files
            and no credentials, and returns its result.
          </p>
          <TextField
            id={`${id}-source`}
            label="Script"
            multiline
            value={text(config['source'])}
            problem={problem('source')}
            note="The body of an async function: end it with return."
            commit={(value) => set('source', value)}
          />
          <SchemaBuilder
            id={`${id}-result`}
            legend="Result it must return"
            empty="The script may return anything."
            schema={config['resultSchema']}
            set={(schema) => set('resultSchema', schema)}
          />
          {timeout}
          <SafeToRetry config={config} set={set} />
        </>
      );
    case 'git_status':
      return (
        <p className="note">Looks at the run’s workspace: its commit, branch and changed files.</p>
      );
    case 'git_diff':
      return (
        <>
          <Select
            id={`${id}-against`}
            label="Compare with"
            value={config['against'] === 'head' ? 'head' : 'base'}
            options={[
              ['base', 'The commit the run started from'],
              ['head', 'The last commit in the workspace'],
            ]}
            change={(next) => set('against', next === 'head' ? 'head' : undefined)}
          />
          <LinesField
            id={`${id}-paths`}
            label="Only these paths, one per line (optional)"
            value={config['paths']}
            commit={(paths) => set('paths', paths)}
          />
        </>
      );
    case 'git_create_branch':
      return field(
        'name',
        'Branch name',
        false,
        'Names the work in the workspace, changes included. Use {{name}} for a value, such as an agent’s suggestion.',
      );
    case 'git_commit':
      return (
        <>
          {field(
            'message',
            'Message',
            true,
            'Commits every change in the workspace. Use {{name}} for a value.',
          )}
          <Check
            label="Commit even when nothing changed"
            checked={config['allowEmpty'] === true}
            change={(checked) => set('allowEmpty', checked ? true : undefined)}
          />
        </>
      );
    case 'git_push': {
      const app = config['transport'] === 'github_app';
      return (
        <>
          <Select
            id={`${id}-transport`}
            label="Push with"
            value={app ? 'github_app' : 'host'}
            options={[
              ['host', 'Your own Git credentials on the server'],
              ['github_app', 'The project’s GitHub App'],
            ]}
            change={(next) =>
              replace({
                ...config,
                transport: next === 'github_app' ? 'github_app' : undefined,
                remote: next === 'github_app' ? undefined : config['remote'],
              })
            }
          />
          {!app && (
            <TextField
              id={`${id}-remote`}
              label="Remote (optional)"
              value={text(config['remote'])}
              placeholder="origin"
              commit={(value) => string('remote', value)}
            />
          )}
          {field('branch', 'Branch (optional)', false, 'The current branch when empty.')}
          {field(
            'remoteBranch',
            'Branch on the remote (optional)',
            false,
            'The same name when empty.',
          )}
          <p className="note">
            {app
              ? 'Pushes to the repository connected in Settings › Projects, with a short-lived token from the App that is never stored. Shift never forces a push.'
              : 'Uses your own Git credentials on the server. Shift never forces a push.'}
          </p>
        </>
      );
    }
    case 'github_get_pr': {
      const byBranch = config['head'] !== undefined && config['number'] === undefined;
      return (
        <>
          <Select
            id={`${id}-find`}
            label="Find it by"
            value={byBranch ? 'head' : 'number'}
            options={[
              ['number', 'Its number'],
              ['head', 'Its branch'],
            ]}
            change={(next) =>
              replace(
                next === 'head'
                  ? { ...config, number: undefined, head: '' }
                  : { ...config, head: undefined, number: '' },
              )
            }
          />
          {byBranch
            ? field('head', 'Branch', false, 'The pull request from this branch of the repository.')
            : field('number', 'Number', false, 'Such as 42, or {{number}} from an earlier step.')}
          <GitHubNote />
        </>
      );
    }
    case 'github_create_pr':
      return (
        <>
          {field('head', 'From branch', false, 'The branch with the work, pushed beforehand.')}
          {field(
            'base',
            'Into branch (optional)',
            false,
            'The repository’s default branch when empty.',
          )}
          {field('title', 'Title')}
          {field('body', 'Description (optional)', true)}
          <Check
            label="Open as a draft"
            checked={config['draft'] === true}
            change={(checked) => set('draft', checked ? true : undefined)}
          />
          <GitHubNote />
        </>
      );
    case 'github_update_pr':
      return (
        <>
          {field('number', 'Number', false, 'Such as {{number}} from Create pull request.')}
          {field('title', 'New title (optional)')}
          {field('body', 'New description (optional)', true)}
          {field('base', 'New base branch (optional)')}
          <Select
            id={`${id}-state`}
            label="State"
            value={text(config['state']) || 'keep'}
            options={[
              ['keep', 'Leave as it is'],
              ['open', 'Open'],
              ['closed', 'Closed'],
            ]}
            change={(next) => set('state', next === 'keep' ? undefined : next)}
          />
          <GitHubNote />
        </>
      );
    case 'github_verify_checks':
    case 'github_wait_checks':
      return (
        <>
          {field(
            'commit',
            'Commit',
            false,
            'A full commit SHA, such as {{sha}} from a pull request’s head. A branch name is refused, since it can move.',
          )}
          <LinesField
            id={`${id}-checks`}
            label="Only these checks, one per line (optional)"
            value={config['checks']}
            commit={(checks) => set('checks', checks)}
          />
          {node.type === 'github_verify_checks' ? (
            <p className="note">
              Reads the checks once. Its result has a state of success, failure, pending or none:
              follow it with a Condition to decide what happens next.
            </p>
          ) : (
            <>
              <NumberField
                id={`${id}-interval`}
                label="Check every (seconds)"
                value={config['intervalMs']}
                scale={1000}
                note="30 seconds when empty."
                set={(value) => set('intervalMs', value)}
              />
              <NumberField
                id={`${id}-wait-timeout`}
                label="Give up after (minutes)"
                value={config['timeoutMs']}
                scale={60_000}
                note="One hour when empty. The run follows the timeout port then."
                set={(value) => set('timeoutMs', value)}
              />
              <p className="note">
                Ends on success when every check passed, failure when one failed. While waiting the
                run uses no active time, and it keeps waiting across restarts.
              </p>
            </>
          )}
          <GitHubNote />
        </>
      );
    case 'github_merge':
      return (
        <>
          {field('number', 'Number', false, 'Such as {{number}} from Create pull request.')}
          <Select
            id={`${id}-method`}
            label="Merge by"
            value={text(config['method']) || 'merge'}
            options={[
              ['merge', 'A merge commit'],
              ['squash', 'Squashing into one commit'],
              ['rebase', 'Rebasing the commits'],
            ]}
            change={(next) => set('method', next === 'merge' ? undefined : next)}
          />
          {field(
            'expectedCommit',
            'Only if the head is this commit (optional)',
            false,
            'GitHub refuses the merge if the pull request’s head moved on.',
          )}
          {field('commitTitle', 'Commit title (optional)')}
          {field('commitMessage', 'Commit message (optional)', true)}
          <p className="note warning-note">
            Merges as soon as the run reaches it. Put the checks, waits and approvals you want
            before it; GitHub’s own branch protections still apply.
          </p>
          <GitHubNote />
        </>
      );
    case 'end':
      return (
        <>
          <div className="field">
            <label htmlFor={`${id}-outcome`}>Ends the run as</label>
            <select
              id={`${id}-outcome`}
              value={config['outcome'] === 'FAILED' ? 'FAILED' : 'COMPLETED'}
              onChange={(event) =>
                set('outcome', event.target.value === 'FAILED' ? 'FAILED' : undefined)
              }
            >
              <option value="COMPLETED">Completed</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>
          {field('reason', 'Reason (optional)')}
        </>
      );
    default:
      return (
        <p className="note">
          The form for this node type is not built yet. Its configuration is kept as it is.
        </p>
      );
  }
}

// These problems already appear under their own field.
const shownOnField = new Set([
  'goal',
  'title',
  'durationMs',
  'model',
  'until',
  'reason',
  'when',
  'data',
  'form',
  'retry',
  'key',
  'value',
  'session',
  'handoffs',
]);

export interface NodeEditing {
  rename: (next: string) => string | null;
  set: (key: string, value: unknown) => void;
  setNode: (key: 'retry' | 'limits' | 'config', value: unknown) => void;
  bindings: BindingEditing;
  renameCase: (index: number, next: string) => string | null;
  connectPort: (port: string, target: string | null) => void;
  typing: (typing: boolean) => void;
  duplicate: () => void;
  remove: () => void;
}

// The selected node on a draft. Connecting here needs no dragging: each named port chooses its
// next node, which is how the keyboard reaches everything the canvas does.
export function NodeEditor({
  document,
  projectId = null,
  node,
  problems,
  focus,
  editing,
}: {
  document: GraphDocument;
  // The workflow's project, whose sessions an agent can continue.
  projectId?: string | null;
  node: DocumentNode;
  problems: DraftProblem[];
  focus: boolean;
  editing: NodeEditing;
}) {
  const [renameProblem, setRenameProblem] = useState<string | undefined>();
  useEffect(() => setRenameProblem(undefined), [node.id]);
  const targets = document.nodes.filter((item) => item.type !== 'manual_trigger');
  const ports = outputPorts(node);
  const own = problems.filter((item) => item.nodeId === node.id);
  return (
    <div className="node-editor">
      <Typing.Provider value={editing.typing}>
        <TextField
          id={`${node.id}-id`}
          label="Name"
          value={node.id}
          autoFocus={focus}
          problem={renameProblem}
          note="Other nodes refer to it by this name."
          commit={(value) => setRenameProblem(editing.rename(value) ?? undefined)}
        />
        {node.type !== 'manual_trigger' && node.type !== 'end' && (
          <BindingsBuilder document={document} node={node} editing={editing.bindings} />
        )}
        <ConfigFields
          document={document}
          projectId={projectId}
          node={node}
          problems={own}
          set={editing.set}
          replace={(config) => editing.setNode('config', config)}
          renameCase={editing.renameCase}
        />
        {node.type !== 'end' && node.type !== 'manual_trigger' && (
          <RetryFields
            node={node}
            problem={own.find((item) => item.field === 'retry')?.message}
            setNode={editing.setNode}
          />
        )}
        <Advanced node={node} />
      </Typing.Provider>
      {ports.length > 0 && (
        <fieldset className="field-group">
          <legend>Goes to</legend>
          {ports.map((port) => {
            const connection = document.connections.find(
              (item) => item.fromNodeId === node.id && item.fromPort === port,
            );
            return (
              <div className="field port-target" key={port}>
                <label htmlFor={`${node.id}-port-${port}`}>{port}</label>
                <select
                  id={`${node.id}-port-${port}`}
                  value={connection?.toNodeId ?? ''}
                  onChange={(event) => editing.connectPort(port, event.target.value || null)}
                >
                  <option value="">Not connected</option>
                  {targets.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id}
                      {item.id === node.id ? ' (itself)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </fieldset>
      )}
      {own.length > 0 && (
        <ul className="node-problems">
          {own
            .filter((item) => !item.field || !shownOnField.has(item.field))
            .map((item, index) => (
              <li key={index} className={item.severity === 'error' ? 'field-error' : 'note'}>
                {item.message}
              </li>
            ))}
        </ul>
      )}
      <div className="actions">
        <button className="button" onClick={editing.duplicate}>
          <Copy aria-hidden="true" />
          Duplicate
        </button>
        <button className="button danger" onClick={editing.remove}>
          <Trash2 aria-hidden="true" />
          Delete
        </button>
      </div>
    </div>
  );
}
