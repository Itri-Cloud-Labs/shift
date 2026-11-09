import { Send, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  Artifact,
  Execution,
  SessionResponse,
  TranscriptPage,
} from '../protocol/generated/types.js';
import { useEscape } from './Attention.js';
import { ask, bridge, useLive } from './bridge.js';
import { relativeTime } from './time.js';

// Agent sessions and reports. Reports are the agent's own Markdown: they are rendered from text
// into React elements only, so no markup, script or remote content in them ever runs, and a link
// shows its address instead of opening.

// ---------- Markdown ----------

// Emphasis, inline code and links inside one line of text.
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const [token] = match;
    if (token.startsWith('`')) parts.push(<code key={match.index}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('**'))
      parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    else {
      const [, label, address] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!;
      parts.push(
        <span key={match.index} className="md-link">
          {label} <span className="note">({address})</span>
        </span>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (paragraph.length) {
      blocks.push(<p key={blocks.length}>{inline(paragraph.join(' '))}</p>);
      paragraph = [];
    }
    if (list) {
      const items = list.items.map((item, index) => <li key={index}>{inline(item)}</li>);
      blocks.push(
        list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>,
      );
      list = null;
    }
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      while (++index < lines.length && !/^\s*```/.test(lines[index]!)) code.push(lines[index]!);
      blocks.push(
        <pre key={blocks.length} className="code">
          {code.join('\n')}
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      // Report headings sit under the island's own headings.
      blocks.push(
        <h4 key={blocks.length} className={`md-h${Math.min(heading[1]!.length, 3)}`}>
          {inline(heading[2]!)}
        </h4>,
      );
    } else if (bullet || numbered) {
      if (paragraph.length) flush();
      const ordered = numbered !== null;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
    } else if (line.trim() === '') flush();
    else {
      if (list) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return <div className="markdown">{blocks}</div>;
}

// ---------- An agent step's reports ----------

const roleLabels: Record<Artifact['role'], string> = {
  human_report: 'Report for you',
  handoff: 'Handoff to the next agent',
};

function Report({ artifact }: { artifact: Artifact }) {
  const read = useLive(async () => {
    const answer = await ask(bridge().data.report(artifact.id));
    return answer.kind === 'report' ? { text: answer.text } : { error: true as const };
  }, [artifact.id]);
  if (!read) return <p className="note">Loading the report…</p>;
  if ('error' in read) return <p className="note">The report could not be read.</p>;
  if (read.text.trim() === '') return <p className="note">The report is empty.</p>;
  return <Markdown text={read.text} />;
}

// The step's own reports, then the earlier ones its corrected turns left, which stay in history.
export function AgentReports({
  runId,
  execution,
  openSession,
}: {
  runId: string;
  execution: Execution;
  openSession: (sessionId: string) => void;
}) {
  const artifacts = useLive(async () => {
    const answer = await ask(bridge().data.artifacts(runId));
    return answer.kind === 'resource'
      ? (answer.value as { artifacts: Artifact[] }).artifacts.filter(
          (item) => item.executionId === execution.id,
        )
      : [];
  }, [runId, execution.id]);
  const output = execution.output as {
    references?: { agentSession?: { id?: string }; artifacts?: Array<{ id?: string }> };
  } | null;
  const own = new Set((output?.references?.artifacts ?? []).map((item) => item.id));
  const sessionId = output?.references?.agentSession?.id;
  const mine = (artifacts ?? []).filter((item) => own.has(item.id));
  const earlier = (artifacts ?? []).filter((item) => !own.has(item.id));
  const [shown, setShown] = useState<string | null>(null);
  const current =
    mine.find((item) => item.id === shown) ??
    mine.find((item) => item.role === 'human_report') ??
    mine[0];
  return (
    <>
      {sessionId && (
        <p className="session-link">
          <button className="button quiet" onClick={() => openSession(sessionId)}>
            Open the agent’s session
          </button>
        </p>
      )}
      <h3 className="section-title">Reports</h3>
      {artifacts === undefined ? (
        <p className="note">Loading reports…</p>
      ) : mine.length === 0 ? (
        <p className="note">
          {execution.state === 'COMPLETED'
            ? 'This step left no reports.'
            : 'Reports appear once the agent completes this step.'}
        </p>
      ) : (
        <>
          {mine.length > 1 && (
            <div className="tabs" role="tablist" aria-label="Reports">
              {mine.map((item) => (
                <button
                  key={item.id}
                  className="tab"
                  role="tab"
                  aria-selected={item.id === current?.id}
                  onClick={() => setShown(item.id)}
                >
                  {roleLabels[item.role]}
                </button>
              ))}
            </div>
          )}
          {current && (
            <div className="report" data-role={current.role}>
              {mine.length === 1 && <p className="note">{roleLabels[current.role]}</p>}
              <Report key={current.id} artifact={current} />
            </div>
          )}
        </>
      )}
      {earlier.length > 0 && (
        <details className="earlier-reports">
          <summary>Earlier reports from corrected turns ({earlier.length})</summary>
          {earlier.map((item) => (
            <div key={item.id} className="report" data-role={item.role}>
              <p className="note">
                {roleLabels[item.role]} · {item.filename}
              </p>
              <Report artifact={item} />
            </div>
          ))}
        </details>
      )}
    </>
  );
}

// ---------- A session ----------

// Reads now, on every change notification and, while `every` is set, on that interval. Owner goals
// change no synchronized run, so a session's island polls while it is open. The last value stays
// shown between reads.
function usePolled<T>(read: () => Promise<T>, key: string, every: number | null): T | undefined {
  const [state, setState] = useState<{ key: string; value: T }>();
  const latest = useRef(0);
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      const ticket = ++latest.current;
      const value = await read();
      if (!stopped && ticket === latest.current) setState({ key, value });
    };
    void refresh();
    const unsubscribe = window.shift?.onChange(() => void refresh());
    const timer = every === null ? undefined : setInterval(() => void refresh(), every);
    return () => {
      stopped = true;
      unsubscribe?.();
      clearInterval(timer);
    };
  }, [key, every]);
  return state?.key === key ? state.value : undefined;
}

type SessionView = SessionResponse['session'];
type Entry = TranscriptPage['entries'][number];

const strategyHints: Record<string, string> = {
  persistent: 'Kept after its runs end, so later runs can continue it.',
  ephemeral: 'Archived when its step ended.',
};

const sessionStates: Record<SessionView['state'], string> = {
  CREATING: 'Starting',
  IDLE: 'Idle',
  BUSY: 'Working',
  BLOCKED: 'Blocked',
  UNAVAILABLE: 'Unavailable',
  ARCHIVED: 'Archived',
};

function TranscriptEntry({ entry }: { entry: Entry }) {
  if (entry.kind === 'tool')
    return (
      <li className="entry" data-kind="tool">
        <span className="entry-who">Tool</span>
        <span className="mono">{entry.tool}</span> <span className="note">{entry.status}</span>
      </li>
    );
  if (entry.kind === 'status')
    return (
      <li className="entry" data-kind="status">
        <span className="note">Turn {entry.status}</span>
      </li>
    );
  return (
    <li className="entry" data-kind={entry.kind}>
      <span className="entry-who">{entry.kind === 'user' ? 'Prompt' : 'Agent'}</span>
      {entry.kind === 'assistant' ? (
        <Markdown text={entry.text ?? ''} />
      ) : (
        <p className="entry-prompt">{entry.text}</p>
      )}
    </li>
  );
}

export function SessionIsland({
  sessionId,
  live,
  close,
}: {
  sessionId: string;
  live: boolean;
  close: () => void;
}) {
  useEscape(close);
  const detail = usePolled(
    async () => {
      const [session, transcript] = await Promise.all([
        ask(bridge().data.session(sessionId)),
        ask(bridge().data.transcript(sessionId)),
      ]);
      if (session.kind !== 'resource') return { error: true as const };
      return {
        session: (session.value as SessionResponse).session,
        entries: transcript.kind === 'resource' ? (transcript.value as TranscriptPage).entries : [],
      };
    },
    sessionId,
    live ? 2_000 : null,
  );
  const [goal, setGoal] = useState('');
  const [sent, setSent] = useState<{ state: string } | { problem: string } | null>(null);
  const session = detail && !('error' in detail) ? detail.session : null;
  const working =
    session !== null &&
    (session.heldBy !== null ||
      session.invocations.some((item) =>
        ['PREPARING', 'SUBMITTING', 'RUNNING', 'UNCERTAIN'].includes(item.state),
      ));
  const canSend =
    live &&
    session !== null &&
    session.mapping === 'READY' &&
    session.state !== 'ARCHIVED' &&
    !working;
  const send = async () => {
    const text = goal.trim();
    if (!text || !canSend) return;
    const answer = await ask(bridge().session.goal(sessionId, text));
    if (answer.kind === 'command' && answer.command.state !== 'rejected') {
      setSent({ state: answer.command.state });
      setGoal('');
    } else
      setSent({
        problem:
          answer.kind === 'command'
            ? (answer.command.message ?? 'The server refused the goal.')
            : 'The goal could not be sent.',
      });
  };
  // Prompts in order, each with what it produced.
  const turns = new Map<string | null, Entry[]>();
  for (const entry of detail && !('error' in detail) ? detail.entries : []) {
    const list = turns.get(entry.invocationId) ?? [];
    list.push(entry);
    turns.set(entry.invocationId, list);
  }
  return (
    <aside className="island session-island" aria-label="Agent session">
      <header className="inspector-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>Agent session</h2>
          <p className="mono">{sessionId.slice(0, 8)}</p>
        </div>
        <button className="button quiet icon" aria-label="Close session" onClick={close}>
          <X />
        </button>
      </header>
      <div className="inspector-body">
        {!detail ? (
          <p className="note">Loading the session…</p>
        ) : 'error' in detail ? (
          <p className="note">The session could not be read.</p>
        ) : (
          <>
            <dl className="fields">
              <dt>State</dt>
              <dd>
                {working && session!.state !== 'ARCHIVED'
                  ? 'Working'
                  : sessionStates[session!.state]}
              </dd>
              <dt>Lifetime</dt>
              <dd>
                {session!.lifetime === 'persistent' ? 'Persistent' : 'Ephemeral'}
                <span className="note"> · {strategyHints[session!.lifetime]}</span>
              </dd>
              <dt>Started</dt>
              <dd>{relativeTime(session!.createdAt)}</dd>
              {session!.nodeId && (
                <>
                  <dt>First node</dt>
                  <dd className="mono">{session!.nodeId}</dd>
                </>
              )}
              <dt>Directory</dt>
              <dd className="mono">{session!.cwd}</dd>
              <dt>Used by</dt>
              <dd>
                {new Set(session!.executions.map((item) => item.runId)).size} run
                {new Set(session!.executions.map((item) => item.runId)).size === 1 ? '' : 's'}
              </dd>
            </dl>
            <h3 className="section-title">Conversation</h3>
            {session!.invocations.length === 0 && (
              <p className="note">Nothing has been sent to this session yet.</p>
            )}
            <ol className="turns">
              {session!.invocations.map((invocation) => (
                <li key={invocation.id} className="turn">
                  <p className="turn-head">
                    <span>
                      {invocation.executionId === null
                        ? 'Your goal'
                        : invocation.kind === 'goal'
                          ? 'Step goal'
                          : invocation.kind === 'correction'
                            ? 'Correction'
                            : 'Continuation'}
                    </span>
                    <span className="note">
                      {invocation.state.toLowerCase()} · {relativeTime(invocation.createdAt)}
                    </span>
                  </p>
                  <ul className="entries">
                    {(turns.get(invocation.id) ?? []).map((entry) => (
                      <TranscriptEntry key={entry.id} entry={entry} />
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
            {(turns.get(null) ?? []).length > 0 && (
              <details>
                <summary>Messages from outside Shift</summary>
                <ul className="entries">
                  {turns.get(null)!.map((entry) => (
                    <Fragment key={entry.id}>
                      <TranscriptEntry entry={entry} />
                    </Fragment>
                  ))}
                </ul>
              </details>
            )}
            <form
              className="goal-form"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <label htmlFor="session-goal">Send this session a goal</label>
              <textarea
                id="session-goal"
                rows={3}
                maxLength={4000}
                value={goal}
                disabled={!canSend}
                placeholder={
                  !live
                    ? 'Connect to the server to send a goal.'
                    : session!.state === 'ARCHIVED'
                      ? 'This session was archived.'
                      : working
                        ? 'The session is working; send when it is idle.'
                        : 'It continues the same conversation, in its own directory.'
                }
                onChange={(event) => setGoal(event.target.value)}
              />
              <div className="actions">
                {sent && (
                  <span className={'problem' in sent ? 'field-error' : 'note'}>
                    {'problem' in sent ? sent.problem : 'Sent. It runs on the server.'}
                  </span>
                )}
                <button className="button primary" disabled={!canSend || goal.trim() === ''}>
                  <Send aria-hidden="true" />
                  Send
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </aside>
  );
}

// ---------- An agent node's session, reports and handoffs ----------

type Raw = Record<string, unknown>;
type SessionList = { sessions: Array<SessionView> };

const requirements: Array<[string, string]> = [
  ['required', 'Required'],
  ['optional', 'Optional'],
  ['off', 'Not asked for'],
];

function Select({
  id,
  label,
  value,
  options,
  note,
  change,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<[string, string, boolean?]>;
  note?: string;
  change: (value: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => change(event.target.value)}>
        {options.map(([option, text, disabled]) => (
          <option key={option} value={option} disabled={disabled}>
            {text}
          </option>
        ))}
      </select>
      {note && <p className="note">{note}</p>}
    </div>
  );
}

// Which conversation the agent works in, which reports it leaves, and which handoffs it reads.
// A default leaves its key out of the configuration.
export function AgentSessionFields({
  id,
  config,
  projectId,
  agents,
  set,
}: {
  id: string;
  config: Raw;
  projectId: string | null;
  // The other agent nodes of the workflow, whose handoffs this one can read.
  agents: string[];
  set: (key: string, value: unknown) => void;
}) {
  const session = (config['session'] ?? {}) as {
    strategy?: string;
    lifetime?: string;
    reference?: string;
  };
  const strategy = session.strategy ?? 'fresh';
  const lifetime = session.lifetime ?? 'persistent';
  const sessions = useLive(async () => {
    if (strategy !== 'reference' || !projectId) return [];
    const answer = await ask(bridge().data.sessions(projectId));
    return answer.kind === 'resource' ? (answer.value as SessionList).sessions : [];
  }, [strategy, projectId]);
  const setSession = (next: { strategy: string; lifetime?: string; reference?: string }) =>
    set(
      'session',
      next.strategy === 'fresh' && (next.lifetime ?? 'persistent') === 'persistent'
        ? undefined
        : next,
    );
  const usable = (sessions ?? []).filter(
    (item) => item.lifetime === 'persistent' && item.state !== 'ARCHIVED',
  );
  const reports = (config['reports'] ?? {}) as { handoff?: string; humanReport?: string };
  const setReports = (key: 'handoff' | 'humanReport', value: string) => {
    const next = { ...reports, [key]: value };
    for (const name of ['handoff', 'humanReport'] as const)
      if (next[name] === 'required') delete next[name];
    set('reports', Object.keys(next).length ? next : undefined);
  };
  const handoffs = (config['handoffs'] ?? {}) as { incoming?: boolean; nodes?: string[] };
  const setHandoffs = (next: { incoming?: boolean; nodes?: string[] }) => {
    const kept = {
      ...(next.incoming === false ? { incoming: false } : {}),
      ...(next.nodes?.length ? { nodes: next.nodes } : {}),
    };
    set('handoffs', Object.keys(kept).length ? kept : undefined);
  };
  return (
    <>
      <fieldset className="field-group">
        <legend>Session</legend>
        <Select
          id={`${id}-session-strategy`}
          label="Conversation"
          value={strategy}
          options={[
            ['fresh', 'A new session each time it runs'],
            ['per_run', 'One session per run, reused when a loop comes back'],
            ['reference', 'Continue an existing session'],
          ]}
          change={(next) =>
            setSession(
              next === 'reference'
                ? { strategy: next, ...(session.reference ? { reference: session.reference } : {}) }
                : { strategy: next, lifetime: next === 'fresh' ? lifetime : 'persistent' },
            )
          }
        />
        {strategy === 'reference' ? (
          <Select
            id={`${id}-session-reference`}
            label="Session"
            value={session.reference ?? ''}
            options={[
              ...(session.reference
                ? []
                : ([['', 'Choose a session', true]] as Array<[string, string, boolean]>)),
              ...usable.map((item): [string, string] => [
                item.id,
                `${item.nodeId ?? 'Session'} · ${relativeTime(item.createdAt)} · ${sessionStates[item.state].toLowerCase()}`,
              ]),
              ...(session.reference && !usable.some((item) => item.id === session.reference)
                ? ([
                    [session.reference, `${session.reference.slice(0, 8)} (not available)`],
                  ] as Array<[string, string]>)
                : []),
            ]}
            note={
              sessions === undefined
                ? 'Loading this project’s sessions…'
                : usable.length === 0
                  ? 'This project has no persistent session yet. A run with a persistent session makes one.'
                  : 'The agent works in that session’s own directory. If another run is using it, this step waits its turn.'
            }
            change={(reference) => setSession({ strategy: 'reference', reference })}
          />
        ) : (
          <Select
            id={`${id}-session-lifetime`}
            label="After the step"
            value={lifetime}
            options={[
              ['persistent', 'Keep the session, so later runs can continue it'],
              ['ephemeral', 'Archive the session', strategy !== 'fresh'],
            ]}
            {...(strategy !== 'fresh'
              ? {
                  note: 'A session reused within a run is kept; only a new session per visit can be archived.',
                }
              : {})}
            change={(next) => setSession({ strategy, lifetime: next })}
          />
        )}
      </fieldset>
      <fieldset className="field-group">
        <legend>Reports</legend>
        <Select
          id={`${id}-reports-human`}
          label="Report for you (toahumanreader.md)"
          value={reports.humanReport ?? 'required'}
          options={requirements}
          change={(value) => setReports('humanReport', value)}
        />
        <Select
          id={`${id}-reports-handoff`}
          label="Handoff to the next agent (tothenextagent.md)"
          value={reports.handoff ?? 'required'}
          options={requirements}
          change={(value) => setReports('handoff', value)}
        />
        <p className="note">
          A missing required report gets the agent a correction. A blocked or failed result needs
          none.
        </p>
      </fieldset>
      <fieldset className="field-group">
        <legend>Handoffs it reads</legend>
        <div className="field">
          <label className="field-check">
            <input
              type="checkbox"
              checked={handoffs.incoming !== false}
              onChange={(event) => setHandoffs({ ...handoffs, incoming: event.target.checked })}
            />
            The handoff that comes in
          </label>
          <p className="note">
            Turn this off for a reviewer who should judge the work without the author’s notes.
          </p>
        </div>
        {agents.length > 0 && (
          <div className="field" role="group" aria-label="Also read the handoffs of">
            <span className="field-label">Also the latest handoff of</span>
            {agents.map((agent) => (
              <label key={agent} className="field-check">
                <input
                  type="checkbox"
                  checked={handoffs.nodes?.includes(agent) ?? false}
                  onChange={(event) =>
                    setHandoffs({
                      ...handoffs,
                      nodes: event.target.checked
                        ? [...(handoffs.nodes ?? []), agent]
                        : (handoffs.nodes ?? []).filter((item) => item !== agent),
                    })
                  }
                />
                <span className="mono">{agent}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </>
  );
}
