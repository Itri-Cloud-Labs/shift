import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { administrativeCall } from './admin-client.js';
import { defaultStateDirectory } from './config.js';
import { ShiftError } from './domain/errors.js';

const options = {
  'state-dir': { type: 'string' },
  'command-id': { type: 'string' },
  path: { type: 'string' },
  name: { type: 'string' },
  'base-ref': { type: 'string' },
  project: { type: 'string' },
  file: { type: 'string' },
  revision: { type: 'string' },
  workflow: { type: 'string' },
  input: { type: 'string' },
  wait: { type: 'boolean' },
  force: { type: 'boolean' },
  reason: { type: 'string' },
  executions: { type: 'string' },
  'active-minutes': { type: 'string' },
  decision: { type: 'string' },
  after: { type: 'string' },
  limit: { type: 'string' },
  all: { type: 'boolean' },
} as const;

type Values = {
  [K in keyof typeof options]?: (typeof options)[K]['type'] extends 'boolean' ? boolean : string;
};

const invalid = (message: string) => new ShiftError('INVALID_CONFIGURATION', message, 422);

// Reports the server's own protocol error rather than a generic administrative failure.
function payloadOf(response: { status: number; payload: unknown }): Record<string, unknown> {
  const payload = (response.payload ?? {}) as Record<string, unknown>;
  if (response.status >= 400) {
    throw new ShiftError(
      typeof payload['code'] === 'string' ? payload['code'] : 'ADMIN_REJECTED',
      typeof payload['message'] === 'string'
        ? payload['message']
        : 'The server rejected the request.',
      response.status,
    );
  }
  return payload;
}

async function json(text: string | undefined, what: string): Promise<unknown> {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw invalid(`${what} must be JSON.`);
  }
}

async function file(path: string | undefined): Promise<unknown> {
  if (!path) throw invalid('--file is required.');
  return json(
    await readFile(resolve(path), 'utf8').catch(() => {
      throw invalid(`Cannot read ${path}.`);
    }),
    path,
  );
}

const revision = (value: string | undefined) => {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw invalid('--revision must be a nonnegative integer.');
  return Number(value);
};

// `shift project|workflow|run …` over the private administrative socket. Mutating commands carry a
// command ID; a transport failure is retried once with the same ID, so a lost response can never
// apply a command twice.
export async function adminCommand(group: string, args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({ args, strict: true, allowPositionals: true, options });
  } catch {
    throw invalid('Invalid command options. Run shift help.');
  }
  const values = parsed.values as Values;
  const [action, target, ...extra] = parsed.positionals;
  if (extra.length > 0) throw invalid('Too many arguments. Run shift help.');
  const stateDirectory = resolve(
    values['state-dir'] ?? process.env['SHIFT_STATE_DIR'] ?? defaultStateDirectory(),
  );
  const get = async (path: string) =>
    payloadOf(await administrativeCall(stateDirectory, { method: 'GET', path }));
  const send = async (method: 'POST' | 'PUT', path: string, body: Record<string, unknown>) => {
    const call = {
      method,
      path,
      body: { ...body, commandId: values['command-id'] ?? randomUUID() },
    };
    try {
      return payloadOf(await administrativeCall(stateDirectory, call));
    } catch (error) {
      if (!(error instanceof ShiftError) || error.code !== 'ADMIN_UNAVAILABLE') throw error;
      return payloadOf(await administrativeCall(stateDirectory, call));
    }
  };
  const print = (value: unknown): void => {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  };
  const need = (value: string | undefined, flag: string) => {
    if (!value) throw invalid(`${flag} is required.`);
    return value;
  };
  const waitFor = async (run: Record<string, unknown>) => {
    // Retry backoffs and timers end on their own; other waits need someone to act.
    const busy = (state: unknown, wait: unknown) =>
      state === 'RUNNING' ||
      state === 'CANCEL_REQUESTED' ||
      (state === 'WAITING' &&
        ['retry', 'timer'].includes((wait as { kind?: string } | null)?.kind ?? ''));
    while (busy(run['state'], run['wait'])) {
      await new Promise((done) => setTimeout(done, 1_000));
      run = (await get(`/api/v0/admin/runs/${String(run['id'])}`))['run'] as Record<
        string,
        unknown
      >;
    }
    return run;
  };
  const command = `${group} ${action ?? ''}`;
  switch (command) {
    case 'project add':
      return print(
        (
          await send('POST', '/api/v0/admin/projects', {
            path: resolve(need(values.path, '--path')),
            ...(values.name === undefined ? {} : { name: values.name }),
            ...(values['base-ref'] === undefined ? {} : { baseRef: values['base-ref'] }),
          })
        )['project'],
      );
    case 'project list':
      return print((await get('/api/v0/admin/projects'))['projects']);
    case 'workflow create':
      return print(
        (
          await send('POST', '/api/v0/admin/workflows', {
            projectId: need(values.project, '--project'),
            name: need(values.name, '--name'),
            draft: await file(values.file),
          })
        )['workflow'],
      );
    case 'workflow save':
      return print(
        (
          await send(
            'PUT',
            `/api/v0/admin/workflows/${encodeURIComponent(need(target, 'WORKFLOW_ID'))}/draft`,
            {
              revision: revision(need(values.revision, '--revision')),
              draft: await file(values.file),
            },
          )
        )['workflow'],
      );
    case 'workflow publish': {
      const expected = revision(values.revision);
      return print(
        (
          await send(
            'POST',
            `/api/v0/admin/workflows/${encodeURIComponent(need(target, 'WORKFLOW_ID'))}/publish`,
            expected === undefined ? {} : { revision: expected },
          )
        )['workflow'],
      );
    }
    case 'workflow show':
      return print(
        (await get(`/api/v0/admin/workflows/${encodeURIComponent(need(target, 'WORKFLOW_ID'))}`))[
          'workflow'
        ],
      );
    case 'workflow list':
      return print(
        (
          await get(
            `/api/v0/admin/workflows${values.project ? `?projectId=${encodeURIComponent(values.project)}` : ''}`,
          )
        )['workflows'],
      );
    case 'run start': {
      const input = await json(values.input, '--input');
      let run = (
        await send('POST', '/api/v0/admin/runs', {
          workflowId: need(values.workflow, '--workflow'),
          ...(input === undefined ? {} : { input }),
        })
      )['run'] as Record<string, unknown>;
      if (values.wait) {
        run = await waitFor(run);
        if (run['state'] !== 'COMPLETED') process.exitCode = 1;
      }
      return print(run);
    }
    case 'run show': {
      let run = (await get(`/api/v0/admin/runs/${encodeURIComponent(need(target, 'RUN_ID'))}`))[
        'run'
      ] as Record<string, unknown>;
      if (values.wait) run = await waitFor(run);
      return print(run);
    }
    case 'run executions': {
      const query = new URLSearchParams();
      for (const name of ['after', 'limit'] as const) {
        const value = values[name];
        if (value === undefined) continue;
        if (!/^\d+$/.test(value)) throw invalid(`--${name} must be a nonnegative integer.`);
        query.set(name, value);
      }
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      const { executions, next } = await get(
        `/api/v0/admin/runs/${encodeURIComponent(need(target, 'RUN_ID'))}/executions${suffix}`,
      );
      return print({ executions, next });
    }
    case 'run list':
      return print((await get('/api/v0/admin/runs'))['runs']);
    case 'run cancel':
    case 'run retry':
    case 'run fail':
    case 'run complete':
    case 'run extend': {
      const body: Record<string, unknown> = {};
      if (values.reason !== undefined && (action === 'cancel' || action === 'fail')) {
        body['reason'] = values.reason;
      }
      if (action === 'complete') body['data'] = await file(values.file);
      if (action === 'extend') {
        const minutes = values['active-minutes'];
        if ((values.executions === undefined) === (minutes === undefined)) {
          throw invalid('Give either --executions or --active-minutes.');
        }
        const amount = values.executions ?? minutes!;
        if (!/^[1-9]\d*$/.test(amount)) throw invalid('The extension must be a positive integer.');
        if (minutes === undefined) body['executions'] = Number(amount);
        else body['activeMs'] = Number(amount) * 60_000;
      }
      let run = (
        await send(
          'POST',
          `/api/v0/admin/runs/${encodeURIComponent(need(target, 'RUN_ID'))}/${action}`,
          body,
        )
      )['run'] as Record<string, unknown>;
      if (values.wait) run = await waitFor(run);
      return print(run);
    }
    case 'workspace list':
      return print(
        (
          await get(
            `/api/v0/admin/workspaces${values.project ? `?projectId=${encodeURIComponent(values.project)}` : ''}`,
          )
        )['workspaces'],
      );
    case 'workspace show':
      return print(
        (await get(`/api/v0/admin/workspaces/${encodeURIComponent(need(target, 'WORKSPACE_ID'))}`))[
          'workspace'
        ],
      );
    case 'workspace remove':
      return print(
        (
          await send(
            'POST',
            `/api/v0/admin/workspaces/${encodeURIComponent(need(target, 'WORKSPACE_ID'))}/remove`,
            values.force ? { force: true } : {},
          )
        )['workspace'],
      );
    case 'device pair': {
      const { pairing } = (await send('POST', '/api/v0/admin/pairing', {})) as {
        pairing: { phrase: string; expiresAt: number };
      };
      return print(pairing);
    }
    case 'device list':
      return print((await get('/api/v0/admin/devices'))['devices']);
    case 'device revoke':
      return print(
        (
          await send(
            'POST',
            `/api/v0/admin/devices/${encodeURIComponent(need(target, 'DEVICE_ID'))}/revoke`,
            {},
          )
        )['device'],
      );
    case 'interaction list':
      return print(
        (await get(`/api/v0/admin/interactions${values.all ? '?all=true' : ''}`))['interactions'],
      );
    case 'interaction show':
      return print(
        (
          await get(
            `/api/v0/admin/interactions/${encodeURIComponent(need(target, 'INTERACTION_ID'))}`,
          )
        )['interaction'],
      );
    case 'interaction respond': {
      const path = `/api/v0/admin/interactions/${encodeURIComponent(need(target, 'INTERACTION_ID'))}`;
      // Without --revision the response is checked against the request as it is now.
      const expected =
        revision(values.revision) ??
        ((await get(path))['interaction'] as { revision: number }).revision;
      const body: Record<string, unknown> = { revision: expected };
      if (values.decision !== undefined) body['decision'] = values.decision;
      if (values.file !== undefined) body['response'] = await file(values.file);
      const interaction = (await send('POST', `${path}/respond`, body))['interaction'] as {
        runId: string;
      };
      if (!values.wait) return print(interaction);
      const run = (await get(`/api/v0/admin/runs/${encodeURIComponent(interaction.runId)}`))[
        'run'
      ] as Record<string, unknown>;
      return print(await waitFor(run));
    }
    default:
      throw invalid('Unknown command. Run shift help.');
  }
}
