import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useEscape } from './Attention.js';
import { ask, bridge } from './bridge.js';

// Adds a project or a workflow on the connected server, and opens it once it exists.
export type Creating = { kind: 'project' } | { kind: 'workflow'; projectId: string };

export function CreateDialog({
  creating,
  live,
  created,
  close,
}: {
  creating: Creating;
  live: boolean;
  created: (id: string) => void;
  close: () => void;
}) {
  useEscape(close);
  const project = creating.kind === 'project';
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setProblem(null);
    const answer = await ask(
      creating.kind === 'project'
        ? bridge().project.create(value)
        : bridge().workflow.create(creating.projectId, value),
    );
    setBusy(false);
    if (answer.kind !== 'command') {
      setProblem('It could not be sent to the server. Check the connection and try again.');
      return;
    }
    const { command, createdId } = answer;
    if (command.state === 'accepted' && createdId) created(createdId);
    else if (command.state === 'rejected') setProblem(command.message ?? 'The server refused it.');
    else if (command.state === 'not_applied')
      setProblem('It did not reach the server. Nothing was created; try again.');
    else
      setProblem(
        'The server has not confirmed it yet. If it went through, it will appear in the list.',
      );
  };
  return (
    <>
      <div className="scrim clear" onPointerDown={close} />
      <form
        className="island create-dialog"
        role="dialog"
        aria-label={project ? 'Add a project' : 'New workflow'}
        onSubmit={(event) => void submit(event)}
      >
        <h2>{project ? 'Add a project' : 'New workflow'}</h2>
        <div className="field">
          <label htmlFor="create-value">{project ? 'Repository path on the server' : 'Name'}</label>
          <input
            id="create-value"
            ref={input}
            value={text}
            maxLength={project ? 4096 : 200}
            spellCheck={false}
            placeholder={project ? '/home/you/projects/payments-service' : undefined}
            aria-invalid={problem ? true : undefined}
            onChange={(event) => setText(event.target.value)}
          />
          {project && (
            <p className="note">
              The top folder of a Git repository on the computer running the server.
            </p>
          )}
          {problem && <p className="field-error">{problem}</p>}
        </div>
        <div className="actions">
          <button type="button" className="button quiet" onClick={close}>
            Cancel
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={!live || busy || text.trim() === ''}
          >
            {project ? 'Add project' : 'Create workflow'}
          </button>
        </div>
      </form>
    </>
  );
}
