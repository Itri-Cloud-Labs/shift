import { CirclePause, CirclePlay, FolderOpen, Send, Square, X } from 'lucide-react';
import { useState } from 'react';
import type { Run } from '../protocol/generated/types.js';
import type { DesktopResponse } from '../shared/contracts.js';
import { ask, bridge } from './bridge.js';
import { useEscape } from './Attention.js';

// Manual intervention in one run (client specification 5.5). The hold comes first and is the
// server's; the composer opens only once nothing of the run is running, and resume hands the step
// back to its own contract. Closing this island, or the app, leaves the hold in place.
export function InterventionIsland({
  run,
  live,
  close,
  openFiles,
}: {
  run: Run;
  live: boolean;
  close: () => void;
  // Present when the run has a workspace to look at.
  openFiles: (() => void) | null;
}) {
  useEscape(close);
  const hold = run.hold ?? null;
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const finished = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.state);
  const cancelling = run.state === 'CANCEL_REQUESTED' || run.cancelRequested;
  const intervening = run.attention?.['code'] === 'INTERVENING';
  // The server refuses a message while any step of the run is running.
  // An agent session exists only once one of its steps has run.
  const hasSession = run.invocations.length > 0;
  const canMessage =
    hold !== null && !hold.activeWork && run.state !== 'CANCEL_REQUESTED' && hasSession;
  const act = async (label: string, call: Promise<DesktopResponse>) => {
    setBusy(label);
    setProblem(null);
    const answer = await ask(call);
    setBusy(null);
    if (answer.kind === 'error') setProblem(answer.message);
    else if (answer.kind === 'command' && answer.command.state === 'rejected')
      setProblem(answer.command.message ?? 'The server refused it.');
    return answer;
  };
  const send = async () => {
    const text = message.trim();
    if (!text) return;
    const answer = await act('Sending…', bridge().run.message(run.id, text));
    if (answer.kind === 'command' && answer.command.state !== 'rejected') setMessage('');
  };
  return (
    <section className="island intervention" aria-label="Intervene in this run">
      <header className="intervention-head">
        <h2>Intervene</h2>
        <button className="button quiet icon" aria-label="Close" onClick={close}>
          <X />
        </button>
      </header>
      {finished ? (
        <p className="note">This run has finished; there is nothing to intervene in.</p>
      ) : hold === null ? (
        <>
          <p className="note">
            Holding the run starts nothing new until you resume it. A step that is running now
            finishes first, unless you stop it. The hold stays if you close the app.
          </p>
          <div className="field">
            <label htmlFor="hold-reason">Why (optional)</label>
            <input
              id="hold-reason"
              value={reason}
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <button
            className="button primary"
            disabled={!live || cancelling || busy !== null}
            onClick={() =>
              void act(
                'Holding…',
                bridge().run.control(run.id, {
                  kind: 'hold',
                  ...(reason.trim() ? { reason: reason.trim() } : {}),
                }),
              )
            }
          >
            <CirclePause aria-hidden="true" />
            Hold the run
          </button>
        </>
      ) : (
        <>
          <p className="note" role="status">
            {hold.activeWork
              ? 'Held. A step is still running; it finishes on its own, or you can stop it.'
              : intervening
                ? 'Held, and the stopped step waits for you. Message its session, then resume to run it again.'
                : 'Held. Nothing new starts until you resume.'}
            {hold.reason ? ` Reason: ${hold.reason}` : ''}
          </p>
          {hold.activeWork && (
            <button
              className="button danger"
              disabled={!live || busy !== null}
              onClick={() => void act('Stopping…', bridge().run.control(run.id, { kind: 'abort' }))}
            >
              <Square aria-hidden="true" />
              Stop the running step
            </button>
          )}
          <div className="field">
            <label htmlFor="intervention-message">Message the run’s agent session</label>
            <textarea
              id="intervention-message"
              rows={4}
              value={message}
              maxLength={20_000}
              disabled={!canMessage}
              placeholder={
                canMessage
                  ? 'Your own message, as a turn of yours.'
                  : !hasSession
                    ? 'This run has no agent session to message yet.'
                    : 'Available once nothing is running.'
              }
              onChange={(event) => setMessage(event.target.value)}
            />
            <p className="note">
              It goes to the session as your turn and never becomes the step’s result.
            </p>
          </div>
          <div className="actions">
            <button
              className="button"
              disabled={!live || !canMessage || busy !== null || !message.trim()}
              onClick={() => void send()}
            >
              <Send aria-hidden="true" />
              Send
            </button>
            <button
              className="button primary"
              disabled={!live || busy !== null || cancelling}
              onClick={() =>
                void act('Resuming…', bridge().run.control(run.id, { kind: 'resume' }))
              }
            >
              <CirclePlay aria-hidden="true" />
              {intervening ? 'Resume: run the step again' : 'Resume'}
            </button>
          </div>
        </>
      )}
      {busy && (
        <p className="note" role="status">
          {busy}
        </p>
      )}
      {problem && <p className="field-error">{problem}</p>}
      {openFiles && (
        <button className="button quiet" onClick={openFiles}>
          <FolderOpen aria-hidden="true" />
          Look at the workspace
        </button>
      )}
    </section>
  );
}
