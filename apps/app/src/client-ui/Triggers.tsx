import { CircleAlert, Copy, KeyRound, Play, ShieldOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LinesField, NumberField } from './Actions.js';
import { ask, bridge, useLive } from './bridge.js';
import { SchemaBuilder } from './Builders.js';
import type { Overlap } from './draft.js';
import { TextField } from './Fields.js';
import type { DocumentNode } from './graph.js';
import { Select } from './Sessions.js';
import { relativeTime } from './time.js';

// Forms, setup and history for the trigger nodes that start runs by themselves (server
// specification 12): GitHub events, schedules and authenticated HTTP requests. What a schedule
// fires, and when, is always the server's answer; the form never computes it.

export interface TriggerContext {
  workflowId: string | null;
  // Whether a published version exists, so the trigger has an address and history.
  published: boolean;
  serverUrl: string | null;
  live: boolean;
  overlap: Overlap;
  setOverlap: (overlap: Overlap) => void;
  openRun: (runId: string) => void;
}

interface Trigger {
  id: string;
  nodeId: string;
  kind: 'github' | 'schedule' | 'webhook';
  nextFireAt: number | null;
  state: {
    lastMisfire?: { policy: string; missed: number; capped: boolean; from: string; to: string };
  };
}

interface Occurrence {
  id: string;
  nodeId: string;
  dedupKey: string;
  receivedAt: number;
  state: 'ACCEPTED' | 'ADMITTED' | 'QUEUED' | 'SKIPPED' | 'REJECTED';
  reason: string | null;
  details: Record<string, unknown>;
  runId: string | null;
}

interface Credential {
  id: string;
  createdAt: number;
  expiresAt: number | null;
  active: boolean;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === 'string' ? value : '');

// GitHub events with the installation permission each needs and the actions authors usually
// pick (server triggers/github-events.ts).
export const githubEvents: Record<
  string,
  { label: string; permission: string; actions: string[]; branch: string | null }
> = {
  pull_request: {
    label: 'Pull request',
    permission: 'pull requests: read',
    actions: [
      'opened',
      'synchronize',
      'reopened',
      'closed',
      'edited',
      'ready_for_review',
      'labeled',
    ],
    branch: 'its base branch',
  },
  push: { label: 'Push', permission: 'contents: read', actions: [], branch: 'the pushed branch' },
  pull_request_review: {
    label: 'Pull request review',
    permission: 'pull requests: read',
    actions: ['submitted', 'edited', 'dismissed'],
    branch: 'the base branch',
  },
  pull_request_review_comment: {
    label: 'Review comment',
    permission: 'pull requests: read',
    actions: ['created', 'edited', 'deleted'],
    branch: 'the base branch',
  },
  issues: {
    label: 'Issue',
    permission: 'issues: read',
    actions: ['opened', 'edited', 'closed', 'reopened', 'labeled', 'assigned'],
    branch: null,
  },
  issue_comment: {
    label: 'Issue or pull request comment',
    permission: 'issues: read',
    actions: ['created', 'edited', 'deleted'],
    branch: null,
  },
  check_run: {
    label: 'Check run',
    permission: 'checks: read',
    actions: ['completed', 'created', 'rerequested'],
    branch: 'the head branch',
  },
  check_suite: {
    label: 'Check suite',
    permission: 'checks: read',
    actions: ['completed', 'requested', 'rerequested'],
    branch: 'the head branch',
  },
  status: {
    label: 'Commit status',
    permission: 'commit statuses: read',
    actions: [],
    branch: 'a branch containing the commit',
  },
  workflow_run: {
    label: 'Actions workflow run',
    permission: 'actions: read',
    actions: ['completed', 'requested', 'in_progress'],
    branch: 'the head branch',
  },
  release: {
    label: 'Release',
    permission: 'contents: read',
    actions: ['published', 'created', 'released', 'prereleased'],
    branch: null,
  },
  create: {
    label: 'Branch or tag created',
    permission: 'contents: read',
    actions: [],
    branch: 'the new branch',
  },
  delete: {
    label: 'Branch or tag deleted',
    permission: 'contents: read',
    actions: [],
    branch: 'the deleted branch',
  },
};

const zones = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf(
      'timeZone',
    );
  } catch {
    return [];
  }
})();

// The workflow's overlap policy, shown with each trigger because that is where it matters.
export function OverlapField({ id, context }: { id: string; context: TriggerContext }) {
  return (
    <Select
      id={`${id}-overlap`}
      label="While a run of this workflow is unfinished"
      value={context.overlap}
      options={[
        ['skip', 'Skip the new start'],
        ['queue', 'Queue it, and start it when the run finishes'],
        ['allow', 'Start another run anyway'],
      ]}
      note="For the whole workflow. Waiting, held and stuck runs are unfinished too. Starting by hand while busy asks you first."
      change={(next) => context.setOverlap(next as Overlap)}
    />
  );
}

export function TriggerFields({
  node,
  problem,
  set,
  replace,
  context,
}: {
  node: DocumentNode;
  problem: (field: string) => string | undefined;
  set: (key: string, value: unknown) => void;
  replace: (config: Record<string, unknown>) => void;
  context: TriggerContext;
}) {
  const { id, config } = node;
  switch (node.type) {
    case 'github_trigger':
      return <GitHubTriggerFields node={node} set={set} replace={replace} problem={problem} />;
    case 'schedule_trigger':
      return <ScheduleFields node={node} set={set} problem={problem} />;
    case 'webhook_trigger':
      return (
        <>
          <Select
            id={`${id}-auth`}
            label="Senders prove who they are with"
            value={text(config['auth']) || 'signature'}
            options={[
              ['signature', 'A signature over each request (recommended)'],
              ['bearer', 'The secret itself, as a bearer token'],
            ]}
            note={
              config['auth'] === 'bearer'
                ? 'Simple, but the secret travels with every request: use HTTPS.'
                : 'The secret never travels, and an old request cannot be replayed.'
            }
            change={(next) => set('auth', next)}
          />
          <SchemaBuilder
            id={`${id}-input`}
            legend="Event fields a request must have"
            empty="Any JSON body is accepted as the run's input."
            schema={config['inputSchema']}
            set={(schema) => set('inputSchema', schema)}
          />
          <WebhookSetup node={node} context={context} />
        </>
      );
    default:
      return null;
  }
}

function GitHubTriggerFields({
  node,
  set,
  replace,
  problem,
}: {
  node: DocumentNode;
  set: (key: string, value: unknown) => void;
  replace: (config: Record<string, unknown>) => void;
  problem: (field: string) => string | undefined;
}) {
  const { id, config } = node;
  const event = text(config['event']) || 'pull_request';
  const spec = githubEvents[event];
  const actions = Array.isArray(config['actions'])
    ? (config['actions'] as unknown[]).filter((item): item is string => typeof item === 'string')
    : [];
  const apps = useLive(async () => {
    const answer = await ask(bridge().data.githubApps());
    return answer.kind === 'resource'
      ? ((answer.value as { apps: Array<{ events: string[] | null }> }).apps ?? [])
      : null;
  }, []);
  const subscribed = apps?.[0]?.events;
  const toggle = (action: string, on: boolean) => {
    const next = on ? [...actions, action] : actions.filter((item) => item !== action);
    set('actions', next.length ? next : undefined);
  };
  return (
    <>
      <Select
        id={`${id}-event`}
        label="When GitHub sends"
        value={event}
        options={Object.entries(githubEvents).map(([name, item]) => [name, item.label])}
        // Another event has other actions; branches carry over.
        change={(next) =>
          replace({
            event: next,
            ...(config['branches'] === undefined ? {} : { branches: config['branches'] }),
          })
        }
      />
      {spec && spec.actions.length > 0 && (
        <fieldset className="field-group">
          <legend>Only these actions</legend>
          {spec.actions.map((action) => (
            <label className="field-check" key={action}>
              <input
                type="checkbox"
                checked={actions.includes(action)}
                onChange={(change) => toggle(action, change.target.checked)}
              />
              {action.replace(/_/g, ' ')}
            </label>
          ))}
          {actions
            .filter((action) => !spec.actions.includes(action))
            .map((action) => (
              <label className="field-check" key={action}>
                <input type="checkbox" checked onChange={() => toggle(action, false)} />
                {action}
              </label>
            ))}
          <p className="note">
            {actions.length ? 'Other actions start nothing.' : 'Any action starts a run.'}
          </p>
        </fieldset>
      )}
      {spec?.branch ? (
        <LinesField
          id={`${id}-branches`}
          label="Only for these branches, one per line (optional)"
          value={config['branches']}
          note={`Matched against ${spec.branch}. * stands for any characters, such as release/*.`}
          problem={problem('branches')}
          commit={(branches) => set('branches', branches)}
        />
      ) : (
        config['branches'] !== undefined && (
          <p className="note warning-note">
            This event has no branch, so a branch filter means it never starts a run.{' '}
            <button className="link" onClick={() => set('branches', undefined)}>
              Remove the filter
            </button>
          </p>
        )
      )}
      <p className="note">
        Needs the project’s GitHub repository (Settings › Projects) and an App with{' '}
        {spec?.permission}.
      </p>
      {subscribed && !subscribed.includes(event) && (
        <p className="note warning-note" role="status">
          <CircleAlert aria-hidden="true" /> Your App’s settings do not subscribe to{' '}
          {spec?.label ?? event} events yet, so GitHub sends none. Add it under Permissions &
          events, then Check again in Settings.
        </p>
      )}
    </>
  );
}

function ScheduleFields({
  node,
  set,
  problem,
}: {
  node: DocumentNode;
  set: (key: string, value: unknown) => void;
  problem: (field: string) => string | undefined;
}) {
  const { id, config } = node;
  const schedule = record(config['schedule']);
  const kind = schedule['kind'] === 'interval' ? 'interval' : 'cron';
  const timezone = text(schedule['timezone']) || 'UTC';
  const setSchedule = (change: Record<string, unknown>) =>
    set('schedule', { ...schedule, ...change });
  return (
    <>
      <Select
        id={`${id}-kind`}
        label="Start runs"
        value={kind}
        options={[
          ['cron', 'At set times (cron)'],
          ['interval', 'Every so many minutes'],
        ]}
        change={(next) =>
          set(
            'schedule',
            next === 'interval'
              ? { kind: 'interval', minutes: 60 }
              : { kind: 'cron', expression: '0 9 * * 1-5', timezone },
          )
        }
      />
      {kind === 'cron' ? (
        <>
          <TextField
            id={`${id}-cron`}
            label="Cron expression"
            value={text(schedule['expression'])}
            note="Five fields: minute, hour, day of month, month, day of week. 0 9 * * 1-5 is 09:00 on weekdays."
            problem={problem('schedule')}
            commit={(value) => setSchedule({ expression: value.trim() })}
          />
          <div className="field">
            <label htmlFor={`${id}-zone`}>Time zone</label>
            <input
              id={`${id}-zone`}
              list={`${id}-zones`}
              defaultValue={timezone}
              spellCheck={false}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value && value !== timezone) setSchedule({ timezone: value });
              }}
            />
            <datalist id={`${id}-zones`}>
              {zones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
            <p className="note">
              Times follow this zone’s clock changes: a time skipped in spring does not run, and a
              time repeated in autumn runs once.
            </p>
          </div>
        </>
      ) : (
        <NumberField
          id={`${id}-minutes`}
          label="Every (minutes)"
          value={schedule['minutes']}
          note="Counted in UTC from when the schedule is published."
          problem={problem('schedule')}
          set={(minutes) => setSchedule({ minutes })}
        />
      )}
      <Select
        id={`${id}-misfire`}
        label="After times missed while the server was off"
        value={text(config['misfire']) || 'latest'}
        options={[
          ['latest', 'Run once, for the latest missed time'],
          ['skip', 'Skip them'],
          ['replay', 'Run each, up to the latest 100'],
        ]}
        change={(next) => set('misfire', next === 'latest' ? undefined : next)}
      />
      <SchedulePreview schedule={schedule} />
    </>
  );
}

// The next instants, as the server's scheduler computes them.
function SchedulePreview({ schedule }: { schedule: Record<string, unknown> }) {
  const request =
    schedule['kind'] === 'interval'
      ? typeof schedule['minutes'] === 'number' &&
        Number.isInteger(schedule['minutes']) &&
        schedule['minutes'] >= 1 &&
        schedule['minutes'] <= 366 * 24 * 60
        ? { kind: 'interval' as const, minutes: schedule['minutes'] }
        : null
      : typeof schedule['expression'] === 'string' && typeof schedule['timezone'] === 'string'
        ? {
            kind: 'cron' as const,
            expression: schedule['expression'].slice(0, 200),
            timezone: schedule['timezone'].slice(0, 64),
          }
        : null;
  const preview = useLive(async () => {
    if (!request) return null;
    const answer = await ask(bridge().data.schedulePreview(request));
    return answer.kind === 'resource'
      ? (answer.value as { instants: number[]; problem: string | null })
      : { instants: [], problem: 'The preview needs a connection to the server.' };
  }, [JSON.stringify(request)]);
  if (!preview) return null;
  const zone = request?.kind === 'cron' ? request.timezone : undefined;
  const format = (at: number) => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        ...(zone ? { timeZone: zone } : {}),
      }).format(new Date(at));
    } catch {
      return new Date(at).toISOString();
    }
  };
  return (
    <div className="schedule-preview" aria-live="polite">
      <h4>Next runs</h4>
      {preview.problem ? (
        <p className="field-error">{preview.problem}</p>
      ) : (
        <ol>
          {preview.instants.map((at) => (
            <li key={at}>
              <span>{format(at)}</span>
              <span className="note mono">{new Date(at).toISOString().replace('.000Z', 'Z')}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function useTriggers(workflowId: string | null, published: boolean) {
  return useLive(async () => {
    if (!workflowId || !published) return null;
    const answer = await ask(bridge().data.triggers(workflowId));
    return answer.kind === 'resource' ? (answer.value as { triggers: Trigger[] }).triggers : null;
  }, [workflowId, published]);
}

// A webhook trigger's address, its secrets and how to send to it.
function WebhookSetup({ node, context }: { node: DocumentNode; context: TriggerContext }) {
  const triggers = useTriggers(context.workflowId, context.published);
  const trigger = triggers?.find((item) => item.nodeId === node.id && item.kind === 'webhook');
  const [issued, setIssued] = useState<string | null>(null);
  // Bumped after a change to reload the credentials; the secret itself is never a dependency, so
  // no hook keeps a copy of it once the reveal closes.
  const [reloads, setReloads] = useState(0);
  const [keepMinutes, setKeepMinutes] = useState<number | undefined>();
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A shown secret disappears when the owner leaves this node.
  useEffect(() => () => setIssued(null), [node.id]);
  const credentials = useLive(async () => {
    if (!trigger) return null;
    const answer = await ask(bridge().data.triggerCredentials(trigger.id));
    return answer.kind === 'resource'
      ? (answer.value as { credentials: Credential[] }).credentials
      : null;
  }, [trigger?.id, reloads]);
  if (!trigger)
    return (
      <p className="note">
        Publish the workflow to give this trigger its address and create its secret.
      </p>
    );
  const url = context.serverUrl
    ? new URL(`/api/v0/triggers/${trigger.id}/events`, context.serverUrl).toString()
    : `/api/v0/triggers/${trigger.id}/events`;
  const active = (credentials ?? []).filter((item) => item.active);
  const rotate = async () => {
    setBusy(true);
    setFailed(null);
    const answer = await ask(bridge().trigger.rotate(trigger.id, keepMinutes));
    setBusy(false);
    setReloads((count) => count + 1);
    if (answer.kind === 'issued' && answer.secret) setIssued(answer.secret);
    else if (answer.kind === 'issued')
      setFailed(
        answer.command.state === 'rejected'
          ? (answer.command.message ?? 'The server refused it.')
          : 'The answer was lost before the secret arrived. Create another one.',
      );
    else setFailed(answer.kind === 'error' ? answer.message : 'The secret was not created.');
  };
  const revoke = async () => {
    if (
      !window.confirm(
        'Stop every secret of this trigger? Senders are refused until you create a new one.',
      )
    )
      return;
    setBusy(true);
    await ask(bridge().trigger.revoke(trigger.id));
    setBusy(false);
    setIssued(null);
    setReloads((count) => count + 1);
  };
  const signed = node.config['auth'] !== 'bearer';
  return (
    <fieldset className="field-group webhook-setup">
      <legend>Address and secret</legend>
      <div className="copy-row">
        <code className="mono">{url}</code>
        <button
          className="button quiet icon"
          aria-label="Copy the address"
          onClick={() => void navigator.clipboard?.writeText(url)}
        >
          <Copy />
        </button>
      </div>
      {issued ? (
        <div className="secret-reveal" role="status">
          <p>
            <strong>Copy this secret now.</strong> It is shown once; Shift keeps it only in a form
            it cannot show again.
          </p>
          <div className="copy-row">
            <code className="mono secret-text">{issued}</code>
            <button
              className="button quiet icon"
              aria-label="Copy the secret"
              onClick={() => void navigator.clipboard?.writeText(issued)}
            >
              <Copy />
            </button>
          </div>
          <button className="button" onClick={() => setIssued(null)}>
            I have saved it
          </button>
        </div>
      ) : (
        <p className="note">
          {active.length === 0
            ? 'No secret yet: every request is refused until you create one.'
            : active.length === 1
              ? `One secret, created ${relativeTime(active[0]!.createdAt)}.`
              : `${active.length} secrets work while senders change over; the older ends ${relativeTime(Math.min(...active.map((item) => item.expiresAt ?? Infinity)))}.`}
        </p>
      )}
      {active.length > 0 && !issued && (
        <NumberField
          id={`${node.id}-keep`}
          label="Keep the current secret working for (minutes, optional)"
          value={keepMinutes}
          note="Without it, the current secret stops as soon as the new one exists."
          set={setKeepMinutes}
        />
      )}
      {failed && <p className="field-error">{failed}</p>}
      <div className="actions">
        <button className="button" disabled={!context.live || busy} onClick={() => void rotate()}>
          <KeyRound aria-hidden="true" />
          {active.length ? 'Replace the secret' : 'Create a secret'}
        </button>
        {active.length > 0 && (
          <button
            className="button danger"
            disabled={!context.live || busy}
            onClick={() => void revoke()}
          >
            <ShieldOff aria-hidden="true" />
            Stop all secrets
          </button>
        )}
      </div>
      <details className="webhook-howto">
        <summary>How senders call it</summary>
        <p className="note">
          POST a JSON body to the address with <code>Content-Type: application/json</code> and
          {signed ? (
            <>
              {' '}
              <code>X-Shift-Event-Id</code>, <code>X-Shift-Timestamp</code> (Unix seconds) and{' '}
              <code>X-Shift-Signature: sha256=…</code>: the HMAC-SHA256 with the secret of the
              timestamp, a dot, the event ID, a dot and the exact body. Requests more than five
              minutes old are refused, and the same event ID and body answer with the first event
              instead of starting another run.
            </>
          ) : (
            <>
              {' '}
              <code>Authorization: Bearer</code> and the secret. Send <code>X-Shift-Event-Id</code>{' '}
              to make a retry safe: the same ID and body answer with the first event instead of
              starting another run.
            </>
          )}
        </p>
        <p className="note">
          The server’s <code>tools/send-trigger-event.mjs</code> sends one, reading the secret from
          the environment:
        </p>
        <pre className="mono">{`SHIFT_TRIGGER_SECRET=… node tools/send-trigger-event.mjs \\
  ${url} \\
  --file event.json${signed ? ' --signature' : ' --bearer'} --event-id order-17`}</pre>
      </details>
    </fieldset>
  );
}

const stateLabels: Record<Occurrence['state'], string> = {
  ACCEPTED: 'Starting',
  ADMITTED: 'Started',
  QUEUED: 'Queued',
  SKIPPED: 'Skipped',
  REJECTED: 'Refused',
};
const stateTones: Record<Occurrence['state'], string> = {
  ACCEPTED: 'running',
  ADMITTED: 'completed',
  QUEUED: 'waiting',
  SKIPPED: 'not_reached',
  REJECTED: 'failed',
};
const reasonLabels: Record<string, string> = {
  OVERLAP: 'a run was unfinished',
  WORKFLOW_PAUSED: 'the workflow was paused',
  WORKFLOW_ARCHIVED: 'the workflow was archived',
};

const describe = (occurrence: Occurrence) => {
  const details = occurrence.details;
  if (typeof details['scheduledFor'] === 'string')
    return `For ${new Date(details['scheduledFor']).toLocaleString()}`;
  if (typeof details['event'] === 'string')
    return `${details['event']}${typeof details['action'] === 'string' ? ` ${details['action']}` : ''}`;
  if (typeof details['eventId'] === 'string') return `Event ${details['eventId']}`;
  return 'Request';
};

// What a trigger received lately and what became of it.
export function TriggerHistory({ node, context }: { node: DocumentNode; context: TriggerContext }) {
  const triggers = useTriggers(context.workflowId, context.published);
  const trigger = triggers?.find((item) => item.nodeId === node.id);
  const occurrences = useLive(async () => {
    if (!context.workflowId || !context.published) return null;
    const answer = await ask(bridge().data.occurrences(context.workflowId));
    return answer.kind === 'resource'
      ? (answer.value as { occurrences: Occurrence[] }).occurrences
      : null;
  }, [context.workflowId, context.published]);
  if (!trigger) return null;
  const own = (occurrences ?? []).filter((item) => item.nodeId === node.id).slice(0, 8);
  const misfire = trigger.state.lastMisfire;
  return (
    <section className="trigger-history" aria-label="Recent starts">
      <h4>Recent starts</h4>
      {trigger.kind === 'schedule' && trigger.nextFireAt !== null && (
        <p className="note">Next {new Date(trigger.nextFireAt).toLocaleString()}.</p>
      )}
      {misfire && (
        <p className="note">
          Missed {misfire.capped ? 'at least ' : ''}
          {misfire.missed} time{misfire.missed === 1 ? '' : 's'} from{' '}
          {new Date(misfire.from).toLocaleString()} to {new Date(misfire.to).toLocaleString()} (
          {misfire.policy === 'replay' ? 'beyond the latest 100' : 'not run'}).
        </p>
      )}
      {own.length === 0 ? (
        <p className="note">Nothing received since it was published.</p>
      ) : (
        <ul className="occurrences">
          {own.map((occurrence) => (
            <li key={occurrence.id}>
              <span className="status" data-status={stateTones[occurrence.state]}>
                {stateLabels[occurrence.state]}
              </span>
              <span className="occurrence-text">
                <span>{describe(occurrence)}</span>
                <span className="note">
                  {relativeTime(occurrence.receivedAt)}
                  {occurrence.reason &&
                    ` · ${reasonLabels[occurrence.reason] ?? occurrence.reason}`}
                </span>
              </span>
              {occurrence.runId && (
                <button
                  className="button quiet icon"
                  aria-label="Open the run"
                  title="Open the run"
                  onClick={() => context.openRun(occurrence.runId!)}
                >
                  <Play />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
