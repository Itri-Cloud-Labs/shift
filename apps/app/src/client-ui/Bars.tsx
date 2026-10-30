import { useReactFlow } from '@xyflow/react';
import {
  Bell,
  CircleAlert,
  ListTree,
  LoaderCircle,
  Maximize,
  Play,
  RefreshCw,
  Square,
  Upload,
  Wifi,
  WifiOff,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { Run } from '../protocol/generated/types.js';
import type { ConnectionView, SyncView } from '../shared/contracts.js';
import { ask, bridge } from './bridge.js';
import { finished, runReason, runStateLabels } from './graph.js';
import { StatusIcon, runTone } from './icons.js';
import { clock, relativeTime } from './time.js';

export type Health = 'live' | 'syncing' | 'offline' | 'stopped';

export function health(connection: ConnectionView, sync: SyncView): Health {
  if (connection.status === 'incompatible' || connection.status === 'revoked') return 'stopped';
  if (sync.status === 'live') return 'live';
  if (connection.status === 'offline' || sync.problem === 'UNREACHABLE') return 'offline';
  return 'syncing';
}

const healthLabels: Record<Health, string> = {
  live: 'Live',
  syncing: 'Syncing…',
  offline: 'Offline',
  stopped: 'Disconnected',
};

// Top right, always on screen: the connection and how many things need the owner.
export function StatusCluster({
  connection,
  sync,
  attention,
  openInbox,
  inboxOpen,
}: {
  connection: ConnectionView;
  sync: SyncView;
  attention: number;
  openInbox: () => void;
  inboxOpen: boolean;
}) {
  const state = health(connection, sync);
  const profile = connection.profiles.find((item) => item.active);
  const host = profile ? new URL(profile.url).host : '';
  return (
    <div className="island status-cluster">
      <span
        className={`chip ${state}`}
        role="status"
        title={host ? `${host}, ${healthLabels[state].toLowerCase()}` : undefined}
      >
        {state === 'live' ? (
          <Wifi aria-hidden="true" />
        ) : state === 'syncing' ? (
          <LoaderCircle className="spin" aria-hidden="true" />
        ) : (
          <WifiOff aria-hidden="true" />
        )}
        {healthLabels[state]}
      </span>
      <button
        className={`chip attention-count${attention ? ' has' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={inboxOpen}
        aria-label={
          attention === 0
            ? 'Nothing needs you. Open the inbox'
            : `${attention} ${attention === 1 ? 'thing needs' : 'things need'} you. Open the inbox`
        }
        onClick={openInbox}
      >
        <Bell aria-hidden="true" />
        {attention}
      </button>
    </div>
  );
}

const incompatible: Partial<Record<NonNullable<ConnectionView['problem']>, string>> = {
  IDENTITY_MISMATCH: 'A different Shift server now answers at this address.',
  PROTOCOL_UNSUPPORTED: 'This server runs a Shift version this app cannot use. Update Shift.',
  INVALID_RESPONSE: 'The server answered in a way this app does not understand.',
};

// One slim line when the connection is not live, with the one action that helps.
export function ConnectionBanner({
  connection,
  sync,
}: {
  connection: ConnectionView;
  sync: SyncView;
}) {
  const state = health(connection, sync);
  const [retrying, setRetrying] = useState(false);
  if (state === 'live' || state === 'syncing') return null;
  const updated = sync.updatedAt ? `Showing data from ${relativeTime(sync.updatedAt)}.` : '';
  const text =
    state === 'offline'
      ? `The server cannot be reached. ${updated}`
      : `${(connection.problem && incompatible[connection.problem]) ?? 'Disconnected from the server.'} ${updated}`;
  return (
    <div
      className="island banner"
      role="alert"
      data-status={state === 'offline' ? 'waiting' : 'failed'}
    >
      <CircleAlert aria-hidden="true" />
      <span>{text.trim()}</span>
      {connection.profileId && state === 'offline' && (
        <button
          className="button"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            await ask(bridge().connection.connect(connection.profileId!));
            setRetrying(false);
          }}
        >
          <RefreshCw className={retrying ? 'spin' : undefined} aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  );
}

// Top center in run mode: what the run is doing, and only the controls that apply now.
export function RunStatus({
  run,
  live,
  now,
  resolve,
}: {
  run: Run;
  live: boolean;
  now: number;
  // Opens the owner's decisions, when the run is stopped for one.
  resolve: (() => void) | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const tone = runTone(run.state);
  const reason = runReason(run, now);
  const cancellable = !finished(run.state) && run.state !== 'CANCEL_REQUESTED';
  const cancel = async () => {
    setConfirming(false);
    setPending('Cancelling…');
    const answer = await ask(bridge().run.cancel(run.id));
    setPending(
      answer.kind === 'command' && answer.command.state === 'unknown'
        ? 'Checking whether the cancel was saved'
        : null,
    );
  };
  return (
    <div className="island run-status" role="status" aria-live="polite">
      <span className="state status" data-status={tone}>
        <StatusIcon status={tone} />
        {runStateLabels[run.state]}
      </span>
      {(pending ?? reason) && <span className="reason">{pending ?? reason}</span>}
      <span className="time" title="Active time used of the run's limit">
        {clock(run.activeTime.usedMs)} / {clock(run.activeTime.limitMs)}
      </span>
      {run.versionNumber !== null && <span className="badge">v{run.versionNumber}</span>}
      {resolve && !confirming && (
        <button className="button primary" onClick={resolve}>
          Decide…
        </button>
      )}
      {cancellable &&
        (confirming ? (
          <>
            <button className="button" onClick={() => setConfirming(false)}>
              Keep running
            </button>
            <button className="button danger" onClick={() => void cancel()} autoFocus>
              Cancel run
            </button>
          </>
        ) : (
          <button className="button" disabled={!live} onClick={() => setConfirming(true)}>
            <Square aria-hidden="true" />
            Cancel…
          </button>
        ))}
    </div>
  );
}

// Bottom center: view controls, and the workflow's actions.
export function Toolbar({
  listOpen,
  toggleList,
  canRun,
  runHint,
  starting,
  run,
  publishLabel,
}: {
  listOpen: boolean;
  toggleList: () => void;
  canRun: boolean;
  runHint: string;
  starting: boolean;
  run: () => void;
  publishLabel: string | null;
}) {
  const flow = useReactFlow();
  return (
    <div className="island toolbar" role="toolbar" aria-label="Canvas">
      <button
        className="button quiet icon"
        aria-label="Zoom out"
        onClick={() => void flow.zoomOut()}
      >
        <ZoomOut />
      </button>
      <button className="button quiet icon" aria-label="Zoom in" onClick={() => void flow.zoomIn()}>
        <ZoomIn />
      </button>
      <button
        className="button quiet icon"
        aria-label="Fit the graph"
        onClick={() => void flow.fitView({ padding: 0.2, duration: 200 })}
      >
        <Maximize />
      </button>
      <button
        className="button quiet icon"
        aria-label="Nodes and connections as a list"
        aria-pressed={listOpen}
        onClick={toggleList}
      >
        <ListTree />
      </button>
      <span className="toolbar-separator" />
      {publishLabel && (
        <span className="badge toolbar-badge">
          <Upload aria-hidden="true" />
          {publishLabel}
        </span>
      )}
      <button
        className="button primary"
        disabled={!canRun || starting}
        title={runHint}
        onClick={run}
      >
        {starting ? (
          <LoaderCircle className="spin" aria-hidden="true" />
        ) : (
          <Play aria-hidden="true" />
        )}
        Run
      </button>
    </div>
  );
}

// Asks for the trigger's input before a run starts.
export function RunInput({
  schema,
  start,
  close,
}: {
  schema: unknown;
  start: (input: unknown) => void;
  close: () => void;
}) {
  const [text, setText] = useState('{\n  \n}');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      start(JSON.parse(text));
    } catch {
      setError('The input must be valid JSON.');
    }
  };
  const fields = Object.keys(
    (schema as { properties?: Record<string, unknown> } | null)?.properties ?? {},
  );
  return (
    <form className="island run-input" onSubmit={submit} aria-label="Run input">
      <h2>Start a run</h2>
      <p>
        This workflow takes input{fields.length ? `: ${fields.join(', ')}` : ''}. The server checks
        it against the trigger's schema.
      </p>
      <label className="visually-hidden" htmlFor="run-input">
        Input as JSON
      </label>
      <textarea
        id="run-input"
        autoFocus
        spellCheck={false}
        value={text}
        aria-invalid={error !== ''}
        onChange={(event) => {
          setText(event.target.value);
          setError('');
        }}
      />
      {error && <p className="field-error">{error}</p>}
      <div className="actions">
        <button type="button" className="button quiet" onClick={close}>
          Not now
        </button>
        <button type="submit" className="button primary">
          <Play aria-hidden="true" />
          Start run
        </button>
      </div>
    </form>
  );
}

// The empty canvas says what to do next.
export function Hint({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="island hint" aria-label={title}>
      <h2>{title}</h2>
      <p>{children}</p>
    </section>
  );
}

export interface NoticeState {
  text: string;
  // `busy` while something is being confirmed; `problem` when it did not happen.
  tone: 'busy' | 'problem';
}

export function Notice({ notice, dismiss }: { notice: NoticeState; dismiss: () => void }) {
  return (
    <div
      className="island banner notice"
      role={notice.tone === 'problem' ? 'alert' : 'status'}
      data-status={notice.tone === 'problem' ? 'failed' : 'waiting'}
    >
      {notice.tone === 'busy' ? (
        <LoaderCircle className="spin" aria-hidden="true" />
      ) : (
        <CircleAlert aria-hidden="true" />
      )}
      <span>{notice.text}</span>
      {notice.tone === 'problem' && (
        <button className="button quiet" onClick={dismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}
