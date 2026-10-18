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
    while (run['state'] === 'RUNNING') {
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
    case 'run list':
      return print((await get('/api/v0/admin/runs'))['runs']);
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
    default:
      throw invalid('Unknown command. Run shift help.');
  }
}
