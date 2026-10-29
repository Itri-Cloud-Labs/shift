import {
  Bell,
  CircleAlert,
  LoaderCircle,
  Plus,
  RotateCcw,
  ShieldCheck,
  TextCursorInput,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Interaction, Run } from '../protocol/generated/types.js';
import type { RunControl, SyncView } from '../shared/contracts.js';
import {
  actorLabel,
  decisionLabel,
  outcomeLabel,
  respondPath,
  runControls,
  type AttentionItem,
  type RunControls,
} from './attention.js';
import { ask, bridge, useLive } from './bridge.js';
import {
  asSchema,
  fieldLabel,
  initialDraft,
  isRequired,
  properties,
  setAt,
  toResponse,
  type Draft,
  type Schema,
} from './forms.js';
import { duration, runReason } from './graph.js';
import { relativeTime } from './time.js';

type Command = SyncView['commands'][number];

// Closes an island on Escape.
function useEscape(close: () => void) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
}

function until(at: number, now: number): string {
  return at <= now ? 'now' : `in ${duration(at - now)}`;
}

// ---------- Human requests ----------

const rejections: Record<string, string> = {
  INTERACTION_CONFLICT: 'Someone else answered first. Their answer is shown once it arrives.',
  INTERACTION_RETIRED:
    'This request expired or its run was cancelled, so it no longer takes answers.',
  REVISION_CONFLICT: 'The request changed after this form opened. Check it and answer again.',
  INTERACTION_NOT_FOUND: 'This request no longer exists on the server.',
};

// A frozen form or approval in the inspector. Only the server's acknowledgement marks it answered;
// an answer whose acknowledgement was lost is confirmed by its receipt, never sent twice.
export function HumanRequest({
  interaction,
  live,
  deviceId,
  commands,
}: {
  interaction: Interaction;
  live: boolean;
  deviceId: string | null;
  commands: Command[];
}) {
  const form = asSchema(interaction.form);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(form));
  const [problems, setProblems] = useState<Map<string, string>>(new Map());
  const [sending, setSending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // A new revision is a new form.
  useEffect(() => {
    setDraft(initialDraft(asSchema(interaction.form)));
    setProblems(new Map());
  }, [interaction.id, interaction.revision]);
  const command = commands
    .filter(
      (item) =>
        item.path === respondPath(interaction.id) && item.createdAt >= interaction.createdAt,
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const checking = sending || command?.state === 'sending' || command?.state === 'unknown';
  const pending = interaction.state === 'PENDING';

  const submit = async (decision?: string) => {
    const converted = toResponse(form, draft);
    setProblems(converted.problems);
    if (converted.problems.size > 0) {
      requestAnimationFrame(() =>
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    setSending(true);
    await ask(
      bridge().interaction.respond(interaction.id, {
        revision: interaction.revision,
        ...(decision === undefined ? {} : { decision }),
        response: converted.value,
      }),
    );
    setSending(false);
  };

  const status = !pending ? null : checking ? (
    <p className="request-status" role="status">
      <LoaderCircle className="spin" aria-hidden="true" />
      {live
        ? 'Checking whether your answer was saved…'
        : 'Checking whether your answer was saved. This finishes when the server is back.'}
    </p>
  ) : command?.state === 'accepted' ? (
    <p className="request-status" role="status">
      <LoaderCircle className="spin" aria-hidden="true" />
      Answer saved. Updating…
    </p>
  ) : command?.state === 'rejected' && command.code ? (
    <p className="request-status problem" role="alert">
      <CircleAlert aria-hidden="true" />
      {command.code === 'INVALID_RESPONSE'
        ? (command.message ?? 'The answer does not match the form.')
        : (rejections[command.code] ?? 'The answer was not accepted.')}
    </p>
  ) : command?.state === 'not_applied' ? (
    <p className="request-status problem" role="alert">
      <CircleAlert aria-hidden="true" />
      Your answer did not reach the server. Send it again.
    </p>
  ) : !live ? (
    <p className="request-status">Answers can be sent once the server is connected.</p>
  ) : null;

  const disabled = !live || checking || command?.state === 'accepted';
  const outcomes = interaction.kind === 'approval' ? (interaction.outcomes ?? []) : null;
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!outcomes) void submit();
  };

  return (
    <section className="request" aria-label={interaction.title}>
      <p className="request-kind">
        {interaction.kind === 'approval' ? (
          <ShieldCheck aria-hidden="true" />
        ) : (
          <TextCursorInput aria-hidden="true" />
        )}
        {interaction.kind === 'approval' ? 'Approval' : 'Input'}
        {pending && interaction.expiresAt !== null && (
          <span className="note"> · expires {until(interaction.expiresAt, Date.now())}</span>
        )}
      </p>
      <h3 className="request-title">{interaction.title}</h3>
      {interaction.instructions && (
        <p className="request-instructions">{interaction.instructions}</p>
      )}
      {pending && interaction.runState === 'HELD' && (
        <p className="request-status">
          This run is held. Your answer is saved now, and the run continues once it resumes.
        </p>
      )}
      {pending ? (
        <form ref={formRef} onSubmit={onSubmit} noValidate>
          <Fields
            schema={form}
            draft={draft}
            path={[]}
            problems={problems}
            disabled={disabled}
            change={(path, value) => setDraft((current) => setAt(current, path, value))}
          />
          {status}
          <div className="actions request-actions">
            {outcomes ? (
              outcomes.map((outcome, index) => (
                <button
                  key={outcome}
                  type="button"
                  className={index === 0 ? 'button primary' : 'button'}
                  disabled={disabled}
                  onClick={() => void submit(outcome)}
                >
                  {outcomeLabel(outcome)}
                </button>
              ))
            ) : (
              <button type="submit" className="button primary" disabled={disabled}>
                Submit
              </button>
            )}
          </div>
        </form>
      ) : (
        <Settled interaction={interaction} deviceId={deviceId} />
      )}
    </section>
  );
}

function Settled({ interaction, deviceId }: { interaction: Interaction; deviceId: string | null }) {
  const { response } = interaction;
  if (interaction.state === 'RESPONDED' && response) {
    const data =
      typeof response.data === 'object' && response.data !== null
        ? Object.entries(response.data as Record<string, unknown>)
        : [];
    const form = asSchema(interaction.form);
    const fieldSchema = (name: string) => asSchema(asSchema(form['properties'])[name]);
    return (
      <>
        <p className="request-status settled" role="status">
          {response.decision ? `${decisionLabel(response.decision)} by` : 'Answered by'}{' '}
          {actorLabel(response.actor, deviceId)}, {relativeTime(response.createdAt)}.
        </p>
        {data.length > 0 && (
          <dl className="fields">
            {data.map(([name, value]) => (
              <div key={name} style={{ display: 'contents' }}>
                <dt>{fieldLabel(name, fieldSchema(name))}</dt>
                <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </>
    );
  }
  return (
    <p className="request-status settled" role="status">
      {interaction.state === 'EXPIRED'
        ? `This request expired ${relativeTime(interaction.settledAt ?? interaction.createdAt)} without an answer.`
        : 'This request was withdrawn when its run was cancelled.'}
    </p>
  );
}

// The typed widgets of a form: text, choices, numbers, dates, checkboxes, groups and lists.
function Fields({
  schema,
  draft,
  path,
  problems,
  disabled,
  change,
}: {
  schema: Schema;
  draft: Draft;
  path: (string | number)[];
  problems: Map<string, string>;
  disabled: boolean;
  change: (path: (string | number)[], value: Draft) => void;
}) {
  const record = typeof draft === 'object' && !Array.isArray(draft) ? draft : {};
  return (
    <>
      {properties(schema).map(([name, child]) => (
        <Field
          key={name}
          name={name}
          schema={child}
          required={isRequired(schema, name)}
          draft={record[name] ?? initialDraft(child)}
          path={[...path, name]}
          problems={problems}
          disabled={disabled}
          change={change}
        />
      ))}
    </>
  );
}

function Field({
  name,
  schema,
  required,
  draft,
  path,
  problems,
  disabled,
  change,
}: {
  name: string;
  schema: Schema;
  required: boolean;
  draft: Draft;
  path: (string | number)[];
  problems: Map<string, string>;
  disabled: boolean;
  change: (path: (string | number)[], value: Draft) => void;
}) {
  const id = useId();
  const label = fieldLabel(name, schema);
  const pointer = `/${path.join('/')}`;
  const problem = problems.get(pointer);
  const description = typeof schema['description'] === 'string' ? schema['description'] : null;
  const describedBy =
    [description ? `${id}-description` : '', problem ? `${id}-problem` : '']
      .filter(Boolean)
      .join(' ') || undefined;
  const type = schema['type'];
  const help = (
    <>
      {description && (
        <p className="field-description" id={`${id}-description`}>
          {description}
        </p>
      )}
      {problem && (
        <p className="field-error" id={`${id}-problem`}>
          {problem}
        </p>
      )}
    </>
  );

  if (type === 'object')
    return (
      <fieldset className="field-group">
        <legend>{label}</legend>
        {description && <p className="field-description">{description}</p>}
        <Fields
          schema={schema}
          draft={draft}
          path={path}
          problems={problems}
          disabled={disabled}
          change={change}
        />
      </fieldset>
    );

  if (type === 'array') {
    const items = asSchema(schema['items']);
    const list = Array.isArray(draft) ? draft : [];
    const max = typeof schema['maxItems'] === 'number' ? schema['maxItems'] : Infinity;
    const min = typeof schema['minItems'] === 'number' ? schema['minItems'] : 0;
    return (
      <fieldset className="field-group">
        <legend>{label}</legend>
        {help}
        {list.map((item, index) => (
          <div className="field-item" key={index}>
            <div className="field-item-body">
              <Field
                name={`${fieldLabel(name, {})} ${index + 1}`}
                schema={{ ...items, title: `${label} ${index + 1}` }}
                required
                draft={item}
                path={[...path, index]}
                problems={problems}
                disabled={disabled}
                change={change}
              />
            </div>
            <button
              type="button"
              className="button quiet icon"
              aria-label={`Remove ${label} ${index + 1}`}
              disabled={disabled || list.length <= min}
              onClick={() =>
                change(
                  path,
                  list.filter((_, other) => other !== index),
                )
              }
            >
              <Trash2 />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button quiet"
          disabled={disabled || list.length >= max}
          onClick={() => change(path, [...list, initialDraft(items)])}
        >
          <Plus aria-hidden="true" />
          Add
        </button>
      </fieldset>
    );
  }

  if (type === 'boolean')
    return (
      <div className="field">
        <label className="field-check">
          <input
            type="checkbox"
            checked={draft === true}
            disabled={disabled}
            aria-describedby={describedBy}
            onChange={(event) => change(path, event.target.checked)}
          />
          {label}
        </label>
        {help}
      </div>
    );

  const text = typeof draft === 'string' ? draft : '';
  const common = {
    id,
    disabled,
    value: text,
    'aria-invalid': problem ? true : undefined,
    'aria-describedby': describedBy,
    'aria-required': required || undefined,
  } as const;
  const choices = Array.isArray(schema['enum']) ? (schema['enum'] as unknown[]) : null;
  const numeric = type === 'number' || type === 'integer';
  const maxLength = typeof schema['maxLength'] === 'number' ? schema['maxLength'] : undefined;
  const format = schema['format'];
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {!required && <span className="note"> (optional)</span>}
      </label>
      {choices ? (
        <select {...common} onChange={(event) => change(path, event.target.value)}>
          {(!required || text === '') && <option value="">Choose…</option>}
          {choices.map((choice) => (
            <option key={String(choice)} value={String(choice)}>
              {String(choice)}
            </option>
          ))}
        </select>
      ) : !numeric && format === undefined && (maxLength === undefined || maxLength > 120) ? (
        <textarea
          {...common}
          rows={3}
          maxLength={maxLength}
          onChange={(event) => change(path, event.target.value)}
        />
      ) : (
        <input
          {...common}
          type={
            numeric
              ? 'number'
              : format === 'date'
                ? 'date'
                : format === 'date-time'
                  ? 'datetime-local'
                  : format === 'email'
                    ? 'email'
                    : format === 'uri'
                      ? 'url'
                      : 'text'
          }
          step={type === 'integer' ? 1 : numeric ? 'any' : undefined}
          min={typeof schema['minimum'] === 'number' ? schema['minimum'] : undefined}
          max={typeof schema['maximum'] === 'number' ? schema['maximum'] : undefined}
          maxLength={maxLength}
          onChange={(event) => change(path, event.target.value)}
        />
      )}
      {help}
    </div>
  );
}

// ---------- Inbox and toast ----------

// Everything open that needs the owner, oldest first. Choosing one opens it on the canvas.
export function Inbox({
  items,
  open,
  close,
}: {
  items: AttentionItem[];
  open: (item: AttentionItem, nodeId: string | null) => void;
  close: () => void;
}) {
  useEscape(close);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <>
      <div className="scrim" onPointerDown={close} />
      <section className="island inbox" role="dialog" aria-modal="true" aria-label="Needs you">
        <header>
          <h2>Needs you</h2>
          <button className="button quiet icon" aria-label="Close" onClick={close}>
            <X />
          </button>
        </header>
        {items.length === 0 ? (
          <p className="inbox-empty">Nothing needs you right now.</p>
        ) : (
          <ul>
            {items.map((item, index) => (
              <li key={item.id}>
                {item.kind === 'request' ? (
                  <button
                    ref={index === 0 ? first : undefined}
                    className="inbox-item"
                    onClick={() => open(item, item.nodeId)}
                  >
                    <span className="inbox-icon" data-status="waiting">
                      {item.interaction?.kind === 'approval' ? (
                        <ShieldCheck aria-hidden="true" />
                      ) : (
                        <TextCursorInput aria-hidden="true" />
                      )}
                    </span>
                    <span className="inbox-text">
                      <strong>{item.title}</strong>
                      <span>
                        {item.interaction?.kind === 'approval' ? 'Approval' : 'Input'} ·{' '}
                        {item.workflowName} · {relativeTime(item.createdAt)}
                        {item.interaction?.expiresAt
                          ? ` · expires ${until(item.interaction.expiresAt, Date.now())}`
                          : ''}
                      </span>
                    </span>
                  </button>
                ) : (
                  <StuckItem item={item} open={open} focus={index === 0 ? first : undefined} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

// A stuck run says why only in its full record, so the row reads it.
function StuckItem({
  item,
  open,
  focus,
}: {
  item: AttentionItem;
  open: (item: AttentionItem, nodeId: string | null) => void;
  focus: React.RefObject<HTMLButtonElement | null> | undefined;
}) {
  const run = useLive<Run | null>(async () => {
    const answer = await ask(bridge().data.run(item.runId));
    return answer.kind === 'resource' ? (answer.value as { run: Run }).run : null;
  }, [item.runId]);
  const nodeId = run ? runControls(run).nodeId : null;
  return (
    <button ref={focus} className="inbox-item" onClick={() => open(item, nodeId)}>
      <span className="inbox-icon" data-status="attention">
        <CircleAlert aria-hidden="true" />
      </span>
      <span className="inbox-text">
        <strong>{(run && runReason(run, Date.now())) ?? item.title}</strong>
        <span>
          {nodeId ? `Stopped at ${nodeId}` : 'Stopped'} · {item.workflowName} ·{' '}
          {relativeTime(item.createdAt)}
        </span>
      </span>
    </button>
  );
}

// A new item, in the corner. It stays in the inbox whether or not the toast is seen.
export function AttentionToast({
  item,
  open,
  dismiss,
}: {
  item: AttentionItem;
  open: () => void;
  dismiss: () => void;
}) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    const timer = setTimeout(dismiss, 12_000);
    return () => clearTimeout(timer);
  }, [item.id, held]);
  return (
    <div
      className="island toast"
      role="status"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <span className="inbox-icon" data-status={item.kind === 'request' ? 'waiting' : 'attention'}>
        <Bell aria-hidden="true" />
      </span>
      <span className="inbox-text">
        <strong>{item.kind === 'request' ? item.title : 'A run needs your decision'}</strong>
        <span>
          {item.kind === 'request'
            ? item.interaction?.kind === 'approval'
              ? 'Approval'
              : 'Input'
            : 'Stopped'}{' '}
          · {item.workflowName}
        </span>
      </span>
      <button className="button" onClick={open}>
        Open
      </button>
      <button className="button quiet icon" aria-label="Dismiss" onClick={dismiss}>
        <X />
      </button>
    </div>
  );
}

// ---------- Owner decisions for a stuck run ----------

type Choice = 'retry' | 'extend' | 'complete' | 'fail';

const choiceLabels: Record<Choice, string> = {
  retry: 'Retry',
  extend: 'Raise limit',
  complete: 'Record result',
  fail: 'Fail step',
};

// The decisions the server accepts for this run, one at a time. A result is checked by the
// server against the step's result schema.
export function Resolve({
  run,
  controls,
  resultSchema,
  live,
  commands,
  close,
}: {
  run: Run;
  controls: RunControls;
  resultSchema: unknown;
  live: boolean;
  commands: Command[];
  close: () => void;
}) {
  useEscape(close);
  const choices = (['retry', 'extend', 'complete', 'fail'] as const).filter((choice) =>
    choice === 'extend' ? controls.extend !== null : controls[choice],
  );
  const [choice, setChoice] = useState<Choice>(choices[0] ?? 'fail');
  const [amount, setAmount] = useState(controls.extend === 'activeMs' ? '30' : '10');
  const [result, setResult] = useState('{\n  \n}');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const command = commands.find((item) => item.commandId === sent);
  useEffect(() => {
    if (command?.state === 'accepted') close();
  }, [command?.state]);
  const checking = sending || command?.state === 'sending' || command?.state === 'unknown';
  const node = controls.nodeId ?? 'the step';
  const fields = Object.keys(asSchema(asSchema(resultSchema)['properties']));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    let control: RunControl;
    if (choice === 'extend') {
      const value = Number(amount);
      if (!Number.isInteger(value) || value < 1)
        return setError('Enter a whole number greater than zero.');
      control =
        controls.extend === 'activeMs'
          ? { kind: 'extend', activeMs: Math.min(value, 43_200) * 60_000 }
          : { kind: 'extend', executions: Math.min(value, 10_000) };
    } else if (choice === 'complete') {
      try {
        control = { kind: 'complete', data: JSON.parse(result) };
      } catch {
        return setError('The result must be valid JSON.');
      }
    } else if (choice === 'fail') {
      control = reason.trim() ? { kind: 'fail', reason: reason.trim() } : { kind: 'fail' };
    } else control = { kind: 'retry' };
    setSending(true);
    const answer = await ask(bridge().run.control(run.id, control));
    setSending(false);
    if (answer.kind === 'command') setSent(answer.command.commandId);
    else setError('The decision could not be sent.');
  };

  const outcome = checking ? (
    <p className="request-status" role="status">
      <LoaderCircle className="spin" aria-hidden="true" />
      Checking whether the decision was saved…
    </p>
  ) : command?.state === 'rejected' ? (
    <p className="field-error" role="alert">
      {command.message ?? 'The server did not accept this decision.'}
    </p>
  ) : command?.state === 'not_applied' ? (
    <p className="field-error" role="alert">
      The decision did not reach the server. Send it again.
    </p>
  ) : null;

  return (
    <form className="island resolve" onSubmit={submit} aria-label="Decide how the run continues">
      <header>
        <h2>Decide how this run continues</h2>
        <button type="button" className="button quiet icon" aria-label="Close" onClick={close}>
          <X />
        </button>
      </header>
      <p className="resolve-reason">{runReason(run, Date.now()) ?? 'This run needs you.'}</p>
      {choices.length > 1 && (
        <div className="segmented" role="radiogroup" aria-label="Decision">
          {choices.map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={choice === item}
              onClick={() => {
                setChoice(item);
                setError('');
              }}
            >
              {choiceLabels[item]}
            </button>
          ))}
        </div>
      )}
      {choice === 'retry' && (
        <p className="note">
          Starts a new attempt of {node} with the same input. What the last attempt did is unknown,
          so check the workspace before retrying. An agent continues in the same session.
        </p>
      )}
      {choice === 'extend' && (
        <div className="field">
          <label htmlFor="resolve-amount">
            {controls.extend === 'activeMs'
              ? 'Minutes of active time to add'
              : 'More executions to allow'}
          </label>
          <input
            id="resolve-amount"
            type="number"
            min={1}
            step={1}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
      )}
      {choice === 'complete' && (
        <div className="field">
          <label htmlFor="resolve-result">
            Result you checked yourself, as JSON
            {fields.length > 0 && <span className="note">: {fields.join(', ')}</span>}
          </label>
          <textarea
            id="resolve-result"
            className="code-input"
            rows={6}
            spellCheck={false}
            value={result}
            onChange={(event) => setResult(event.target.value)}
          />
        </div>
      )}
      {choice === 'fail' && (
        <div className="field">
          <p className="note">
            {node} fails as abandoned and follows its error connection, or the run fails.
          </p>
          <label htmlFor="resolve-reason">
            Reason <span className="note">(optional)</span>
          </label>
          <input
            id="resolve-reason"
            type="text"
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {outcome}
      <div className="actions">
        <button type="button" className="button quiet" onClick={close}>
          Not now
        </button>
        <button
          type="submit"
          className={choice === 'fail' ? 'button danger' : 'button primary'}
          disabled={!live || checking}
          title={live ? undefined : 'Decisions can be sent once the server is connected.'}
        >
          {choice === 'retry' && <RotateCcw aria-hidden="true" />}
          {choiceLabels[choice]}
        </button>
      </div>
    </form>
  );
}
