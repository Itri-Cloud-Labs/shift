import { Plus, Trash2 } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { ask, bridge, useLive } from './bridge.js';
import { TextField } from './Fields.js';
import { Select } from './Sessions.js';

// Forms for Command, HTTP, Script and Git nodes (client specification 6.2 and 6.3). Lists are
// written one item per line; credentials are chosen by name from the project, and their values
// never reach this page.

type Config = Record<string, unknown>;

interface Credential {
  id: string;
  name: string;
}

export function useCredentials(projectId: string | null): Credential[] | undefined {
  return useLive(async () => {
    if (!projectId) return [];
    const answer = await ask(bridge().data.credentials(projectId));
    return answer.kind === 'resource'
      ? (answer.value as { credentials: Credential[] }).credentials
      : [];
  }, [projectId]);
}

const lines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim() !== '');

// A list of strings, one per line.
export function LinesField({
  id,
  label,
  value,
  note,
  problem,
  commit,
}: {
  id: string;
  label: string;
  value: unknown;
  note?: string;
  problem?: string | undefined;
  commit: (items: string[] | undefined) => void;
}) {
  const items = Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
  return (
    <TextField
      id={id}
      label={label}
      multiline
      value={items.join('\n')}
      note={note}
      problem={problem}
      commit={(text) => {
        const next = lines(text);
        commit(next.length ? next : undefined);
      }}
    />
  );
}

// Names with values, one `NAME=value` (or `Name: value`) per line.
export function PairsField({
  id,
  label,
  value,
  separator,
  note,
  problem,
  commit,
}: {
  id: string;
  label: string;
  value: unknown;
  separator: '=' | ':';
  note?: string;
  problem?: string | undefined;
  commit: (pairs: Record<string, string> | undefined) => void;
}) {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const join = separator === '=' ? '=' : ': ';
  return (
    <TextField
      id={id}
      label={label}
      multiline
      value={Object.entries(record)
        .map(([name, item]) => `${name}${join}${typeof item === 'string' ? item : ''}`)
        .join('\n')}
      note={note}
      problem={problem}
      commit={(text) => {
        const next: Record<string, string> = {};
        for (const line of lines(text)) {
          const at = line.indexOf(separator);
          const name = (at < 0 ? line : line.slice(0, at)).trim();
          if (name) next[name] = at < 0 ? '' : line.slice(at + 1).replace(/^ /, '');
        }
        commit(Object.keys(next).length ? next : undefined);
      }}
    />
  );
}

// Which credentials go where: an environment variable or a header, each with a credential name
// from the project. A header can add a prefix such as `Bearer `.
export function CredentialRefs({
  id,
  legend,
  target,
  projectId,
  value,
  prefix,
  commit,
}: {
  id: string;
  legend: string;
  target: string;
  projectId: string | null;
  value: unknown;
  prefix?: boolean;
  commit: (refs: Record<string, unknown> | undefined) => void;
}) {
  const credentials = useCredentials(projectId);
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const rows = Object.entries(record).map(([name, ref]) => ({
    name,
    credential:
      typeof ref === 'string' ? ref : String((ref as { credential?: unknown })?.credential ?? ''),
    prefix: typeof ref === 'object' && ref !== null ? String((ref as Config)['prefix'] ?? '') : '',
  }));
  const save = (next: typeof rows) => {
    const refs: Record<string, unknown> = {};
    for (const row of next)
      if (row.name)
        refs[row.name] = prefix
          ? { credential: row.credential, ...(row.prefix ? { prefix: row.prefix } : {}) }
          : row.credential;
    commit(Object.keys(refs).length ? refs : undefined);
  };
  const names = (credentials ?? []).map((item) => item.name);
  return (
    <fieldset className="field-group">
      <legend>{legend}</legend>
      {rows.length === 0 && (
        <p className="note">None. Add credentials in Settings, then use them here.</p>
      )}
      {rows.map((row, index) => (
        <div key={index} className="credential-ref">
          <TextField
            id={`${id}-${index}-name`}
            label={target}
            value={row.name}
            commit={(name) =>
              save(rows.map((item, at) => (at === index ? { ...item, name } : item)))
            }
          />
          <div className="field">
            <label htmlFor={`${id}-${index}-credential`}>Credential</label>
            <select
              id={`${id}-${index}-credential`}
              value={row.credential}
              onChange={(event) =>
                save(
                  rows.map((item, at) =>
                    at === index ? { ...item, credential: event.target.value } : item,
                  ),
                )
              }
            >
              {!names.includes(row.credential) && (
                <option value={row.credential}>
                  {row.credential ? `${row.credential} (not in this project)` : 'Choose…'}
                </option>
              )}
              {names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          {prefix && (
            <TextField
              id={`${id}-${index}-prefix`}
              label="Prefix (optional)"
              value={row.prefix}
              placeholder="Bearer "
              commit={(next) =>
                save(rows.map((item, at) => (at === index ? { ...item, prefix: next } : item)))
              }
            />
          )}
          <button
            type="button"
            className="button quiet icon"
            aria-label={`Remove ${row.name || 'this credential'}`}
            onClick={() => save(rows.filter((_item, at) => at !== index))}
          >
            <Trash2 />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button quiet"
        onClick={() =>
          save([
            ...rows,
            {
              name: prefix ? 'Authorization' : `SECRET_${rows.length + 1}`,
              credential: names[0] ?? '',
              prefix: prefix ? 'Bearer ' : '',
            },
          ])
        }
      >
        <Plus aria-hidden="true" />
        Add a credential
      </button>
    </fieldset>
  );
}

export function Check({
  label,
  checked,
  note,
  change,
}: {
  label: string;
  checked: boolean;
  note?: ReactNode;
  change: (checked: boolean) => void;
}) {
  return (
    <div className="field">
      <label className="field-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => change(event.target.checked)}
        />
        {label}
      </label>
      {note && <p className="note">{note}</p>}
    </div>
  );
}

// Whether Shift may run the action again on its own when it cannot tell whether it finished.
export function SafeToRetry({
  config,
  set,
}: {
  config: Config;
  set: (key: string, value: unknown) => void;
}) {
  return (
    <Check
      label="Safe to run again"
      checked={config['safeToRetry'] === true}
      note="If Shift stops while this runs, it runs it again instead of asking you. Only for actions where twice does no harm, such as tests."
      change={(checked) => set('safeToRetry', checked ? true : undefined)}
    />
  );
}

export function NumberField({
  id,
  label,
  value,
  scale = 1,
  note,
  set,
}: {
  id: string;
  label: string;
  value: unknown;
  // Stored value per shown unit, such as 1000 for seconds stored as milliseconds.
  scale?: number;
  note?: string;
  set: (value: number | undefined) => void;
}) {
  return (
    <TextField
      id={id}
      label={label}
      numeric
      note={note}
      value={typeof value === 'number' ? String(value / scale) : ''}
      commit={(text) => {
        const number = Number(text);
        set(
          text.trim() === '' || !Number.isFinite(number) || number <= 0
            ? undefined
            : Math.round(number * scale),
        );
      }}
    />
  );
}

export function MethodSelect({
  id,
  value,
  set,
}: {
  id: string;
  value: unknown;
  set: (value: string | undefined) => void;
}) {
  return (
    <Select
      id={id}
      label="Method"
      value={typeof value === 'string' ? value : 'GET'}
      options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((method) => [
        method,
        method,
      ])}
      change={(next) => set(next === 'GET' ? undefined : next)}
    />
  );
}

// ---------- What an action did, as recorded when it ran ----------

type Data = Record<string, unknown>;

const short = (commit: unknown) => (typeof commit === 'string' ? commit.slice(0, 12) : '');
const str = (value: unknown) => (typeof value === 'string' ? value : '');

const operationStates: Record<string, string> = {
  INTENDED: 'Recorded, not started',
  SUBMITTED: 'Started; outcome not recorded',
  SUCCEEDED: 'Finished',
  FAILED: 'Failed',
  UNKNOWN: 'Outcome unknown',
  ABANDONED: 'Set aside',
};

function Stream({ label, data, name }: { label: string; data: Data; name: 'stdout' | 'stderr' }) {
  const text = str(data[name]);
  if (!text) return null;
  return (
    <>
      <h3 className="section-title">{label}</h3>
      {data[`${name}Truncated`] === true && (
        <p className="note">
          The last part of {String(data[`${name}Bytes`])} bytes; the beginning was not kept.
        </p>
      )}
      <pre className="code">{text}</pre>
    </>
  );
}

export interface ActionExecution {
  output?: unknown;
  error?: unknown;
  operations?: Array<{
    id: string;
    key: string;
    state: string;
    evidence: Record<string, unknown>;
    resolution?: unknown;
  }>;
}

// The readable part of an action step: its output, or the output its error carries, and the
// operations Shift recorded. Nothing here reads the workspace now; it shows what was recorded.
export function ActionResult({ type, execution }: { type: string; execution: ActionExecution }) {
  const output = (execution.output as { data?: unknown } | null | undefined)?.data;
  const details = (execution.error as { details?: unknown } | null | undefined)?.details;
  const data = (output ?? details ?? {}) as Data;
  const facts: Array<[string, string]> = [];
  if (type === 'command' && typeof data['exitCode'] !== 'undefined')
    facts.push([
      'Exit code',
      data['exitCode'] === null ? `killed (${str(data['signal'])})` : String(data['exitCode']),
    ]);
  if (type === 'http' && typeof data['status'] === 'number')
    facts.push(['Status', String(data['status'])]);
  if (typeof data['durationMs'] === 'number')
    facts.push(['Took', `${Math.round(data['durationMs'] as number)} ms`]);
  if (type === 'git_status' || type === 'git_diff') {
    facts.push(['Branch', str(data['branch']) || 'none (detached)']);
    facts.push(['HEAD', short(data['head'])]);
  }
  if (type === 'git_create_branch')
    facts.push(['Branch', str(data['branch'])], ['At', short(data['commit'])]);
  if (type === 'git_commit')
    facts.push(
      ['Commit', short(data['commit'])],
      ['Parent', short(data['parent'])],
      ['Branch', str(data['branch'])],
    );
  if (type === 'git_push')
    facts.push(
      ['Pushed', short(data['commit'])],
      ['To', `${str(data['remoteRef'])} on ${str(data['remote'])}`],
      ['Before', short(data['before']) || 'absent'],
    );
  const entries = Array.isArray(data['entries']) ? (data['entries'] as Data[]) : [];
  const files = Array.isArray(data['files']) ? (data['files'] as Data[]) : [];
  const operations = execution.operations ?? [];
  return (
    <>
      {facts.length > 0 && (
        <dl className="fields">
          {facts
            .filter(([, value]) => value !== '')
            .map(([label, value]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd className="mono">{value}</dd>
              </Fragment>
            ))}
        </dl>
      )}
      {type === 'command' && (
        <>
          <Stream label="Output" data={data} name="stdout" />
          <Stream label="Errors" data={data} name="stderr" />
        </>
      )}
      {type === 'http' && data['body'] !== undefined && (
        <>
          <h3 className="section-title">Response</h3>
          <pre className="code">
            {typeof data['body'] === 'string'
              ? data['body']
              : JSON.stringify(data['body'], null, 2)}
          </pre>
        </>
      )}
      {type === 'git_status' && (
        <>
          <h3 className="section-title">Changed files</h3>
          {entries.length === 0 ? (
            <p className="note">No changes.</p>
          ) : (
            <ul className="attempts">
              {entries.map((entry, index) => (
                <li key={index}>
                  <span className="mono">{str(entry['path'])}</span>
                  <span className="note">
                    {`${str(entry['index'])}${str(entry['worktree'])}`.trim()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {type === 'git_diff' && (
        <>
          <h3 className="section-title">Files</h3>
          <ul className="attempts">
            {files.map((file, index) => (
              <li key={index}>
                <span className="mono">{str(file['path'])}</span>
                <span className="note">
                  +{String(file['additions'] ?? '?')} −{String(file['deletions'] ?? '?')}
                </span>
              </li>
            ))}
            {(Array.isArray(data['untracked']) ? (data['untracked'] as string[]) : []).map(
              (path) => (
                <li key={path}>
                  <span className="mono">{path}</span>
                  <span className="note">new, not in the diff</span>
                </li>
              ),
            )}
          </ul>
          {str(data['diff']) && (
            <details className="raw-output">
              <summary>Diff{data['truncated'] === true ? ' (cut short)' : ''}</summary>
              <pre className="code">{str(data['diff'])}</pre>
            </details>
          )}
        </>
      )}
      {operations.length > 0 && (
        <>
          <h3 className="section-title">Operations</h3>
          <p className="note">
            Recorded when it ran. Later changes to the workspace or remote do not alter them.
          </p>
          <ul className="attempts">
            {operations.map((operation) => {
              const resolution = operation.resolution as { by?: string; control?: string } | null;
              return (
                <li key={operation.id}>
                  <span>{operationStates[operation.state] ?? operation.state}</span>
                  <span className="note">
                    {resolution?.by === 'owner'
                      ? `you chose ${resolution.control ?? 'it'}`
                      : resolution?.by === 'shift'
                        ? 'safe to run again'
                        : `operation ${operation.key.split('/').at(-1)}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
