import { CircleAlert, Copy, GitCompareArrows, Trash2, TriangleAlert, X } from 'lucide-react';
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
import { unknownConfig } from './config.js';
import { addableTypes, type DraftProblem } from './draft.js';
import { TextField, Typing } from './Fields.js';
import { outputPorts, typeLabels, type DocumentNode, type GraphDocument } from './graph.js';
import { TypeIcon } from './icons.js';

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
const templated = new Set(['goal', 'title', 'instructions', 'until']);

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
  problems,
  set,
  replace,
  renameCase,
}: {
  node: DocumentNode;
  document: GraphDocument;
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
            {config['value'] !== undefined && (
              <TemplateValue
                id={`${id}-value`}
                value={config['value']}
                bindings={bindings}
                set={(value) => set('value', value)}
              />
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
  node,
  problems,
  focus,
  editing,
}: {
  document: GraphDocument;
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
