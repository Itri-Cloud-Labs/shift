import { CircleAlert, Copy, GitCompareArrows, Trash2, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useEscape } from './Attention.js';
import { addableTypes, type DraftProblem } from './draft.js';
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

// A text field that commits when it loses focus or on Enter, so one edit is one undo step. An
// undo elsewhere replaces what it shows.
function TextField({
  id,
  label,
  value,
  multiline,
  placeholder,
  note,
  problem,
  numeric,
  autoFocus,
  commit,
}: {
  id: string;
  label: string;
  value: string;
  multiline?: boolean;
  placeholder?: string;
  note?: string | undefined;
  problem?: string | undefined;
  numeric?: boolean;
  autoFocus?: boolean;
  commit: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const props = {
    id,
    value: text,
    placeholder,
    autoFocus,
    spellCheck: false,
    'aria-invalid': problem ? true : undefined,
    onChange: (event: { target: { value: string } }) => setText(event.target.value),
    onBlur: () => {
      if (text !== value) commit(text);
    },
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea {...props} rows={5} />
      ) : (
        <input
          {...props}
          type={numeric ? 'number' : 'text'}
          min={numeric ? 0 : undefined}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && text !== value) commit(text);
          }}
        />
      )}
      {note && <p className="note">{note}</p>}
      {problem && <p className="field-error">{problem}</p>}
    </div>
  );
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const seconds = (value: unknown) => (typeof value === 'number' ? String(value / 1000) : '');

// Forms for what can be set with plain fields. Everything else in a node's config is kept as it
// came; the builders for rules, bindings and schemas come with the rest of prompt 13.
function ConfigFields({
  node,
  problems,
  set,
}: {
  node: DocumentNode;
  problems: DraftProblem[];
  set: (key: string, value: unknown) => void;
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
  const field = (key: string, label: string, multiline = false, note?: string) => (
    <TextField
      id={`${id}-${key}`}
      label={label}
      value={text(config[key])}
      multiline={multiline}
      note={note}
      problem={problem(key)}
      commit={(value) => string(key, value)}
    />
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
const shownOnField = new Set(['goal', 'title', 'durationMs', 'model', 'until', 'reason']);

export interface NodeEditing {
  rename: (next: string) => string | null;
  set: (key: string, value: unknown) => void;
  connectPort: (port: string, target: string | null) => void;
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
      <TextField
        id={`${node.id}-id`}
        label="Name"
        value={node.id}
        autoFocus={focus}
        problem={renameProblem}
        note="Other nodes refer to it by this name."
        commit={(value) => setRenameProblem(editing.rename(value) ?? undefined)}
      />
      <ConfigFields node={node} problems={own} set={editing.set} />
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
