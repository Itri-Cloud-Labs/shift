import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { eventually, runCli, startChild, temporaryState } from '../helpers.js';
import { environment, key, model, skip } from './opencode-setup.js';

// `shift serve` driving real OpenCode, with paid model calls; see opencode-setup.ts.
interface Run {
  id: string;
  state: string;
  outcome: unknown;
  attention: { code: string } | null;
  invocations: Array<{ kind: string; state: string }>;
  workspace: { path: string } | null;
}

async function toolProcess(stateDirectory: string): Promise<number> {
  for (let attempt = 0; attempt < 240; attempt++) {
    for (const entry of await readdir('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const environ = await readFile(`/proc/${entry}/environ`, 'utf8');
        const command = await readFile(`/proc/${entry}/cmdline`, 'utf8');
        // Every runtime process carries the namespace's plugin path, in either environment.
        if (
          command.startsWith('sleep\0') &&
          environ.includes(`${stateDirectory}/harness/opencode/`)
        ) {
          return Number(entry);
        }
      } catch {
        // The process exited while being inspected.
      }
    }
    await delay(250);
  }
  throw new Error('The agent never started its shell command.');
}

test(
  'shift runs a real OpenCode agent and survives being killed',
  { skip, timeout: 600_000 },
  async (t) => {
    const state = await temporaryState();
    const repo = join(state.path, 'repo');
    await mkdir(repo);
    await writeFile(join(repo, 'notes.txt'), 'alpha beta gamma\ndelta\n');
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'],
      {
        cwd: repo,
      },
    );
    const serve = () =>
      startChild(
        state.path,
        ['--opencode-model', model, '--opencode-environment', environment],
        key === undefined ? {} : { SHIFT_OPENCODE_API_KEY: key },
      );
    const shift = async (...args: string[]) => {
      const result = await runCli([...args, '--state-dir', state.path]);
      if (result.code !== 0) throw new Error(result.errors);
      return JSON.parse(result.output) as Run;
    };
    const until = async (id: string) => {
      const deadline = Date.now() + 240_000;
      for (;;) {
        const run = await shift('run', 'show', id);
        if (run.state !== 'RUNNING' || Date.now() > deadline) return run;
        await delay(1_000);
      }
    };
    // Publishes start -> each agent in turn -> end, then starts it.
    let projectId: string | undefined;
    const startAgents = async (agents: Array<{ id: string; config: Record<string, unknown> }>) => {
      projectId ??= ((await shift('project', 'add', '--path', repo)) as unknown as { id: string })
        .id;
      const file = join(state.path, `workflow-${Date.now()}.json`);
      const ids = ['start', ...agents.map((agent) => agent.id), 'end'];
      await writeFile(
        file,
        JSON.stringify({
          nodes: [
            { id: 'start', type: 'manual_trigger' },
            ...agents.map((agent) => ({ id: agent.id, type: 'agent', config: agent.config })),
            { id: 'end', type: 'end' },
          ],
          connections: ids.slice(1).map((to, index) => ({
            id: `c${index + 1}`,
            fromNodeId: ids[index],
            fromPort: 'success',
            toNodeId: to,
            toPort: 'input',
          })),
        }),
      );
      const workflow = (await shift(
        'workflow',
        'create',
        '--project',
        projectId,
        '--name',
        `run ${Date.now()}`,
        '--file',
        file,
      )) as unknown as { id: string };
      await shift('workflow', 'publish', workflow.id);
      return shift('run', 'start', '--workflow', workflow.id);
    };
    const startAgent = (agent: Record<string, unknown>) =>
      startAgents([{ id: 'agent', config: agent }]);
    let server = await serve();
    try {
      await t.test('a read-only run completes with a schema-valid result', async () => {
        const run = await startAgent({
          goal: 'Count the words in notes.txt.',
          readOnly: true,
          resultSchema: {
            type: 'object',
            required: ['words'],
            properties: { words: { type: 'integer' } },
            additionalProperties: false,
          },
        });
        const finished = await until(run.id);
        assert.equal(finished.state, 'COMPLETED', JSON.stringify(finished));
        assert.deepEqual(finished.outcome, { data: { words: 4 } });
        assert.ok(finished.workspace?.path.startsWith(join(state.path, 'workspaces')));
      });

      await t.test(
        'killing Shift mid-tool kills the tool and reports an unknown outcome',
        async () => {
          const run = await startAgent({
            goal: 'Run the shell command `sleep 15 && echo done > crash-marker.txt` and wait for it. Then report {"done": true}.',
          });
          const tool = await toolProcess(state.path);
          await server.terminate('SIGKILL');
          server = await serve();
          const finished = await until(run.id);
          assert.equal(finished.state, 'NEEDS_HUMAN', JSON.stringify(finished));
          assert.equal(finished.attention?.code, 'HARNESS_OUTCOME_UNKNOWN');
          assert.equal(existsSync(`/proc/${tool}`), false);
          await delay(16_000);
          for (const directory of [repo, finished.workspace!.path]) {
            assert.equal(
              existsSync(join(directory, 'crash-marker.txt')),
              false,
              'the effect never happened',
            );
          }
        },
      );
      await t.test('an agent leaves reports, and the next agent reads its handoff', async () => {
        const run = await startAgents([
          {
            id: 'write',
            config: {
              goal: 'Count the words in notes.txt. In your handoff for the next agent, include the line "Codeword: heliotrope".',
              readOnly: true,
              resultSchema: {
                type: 'object',
                required: ['words'],
                properties: { words: { type: 'integer' } },
                additionalProperties: false,
              },
            },
          },
          {
            id: 'review',
            config: {
              goal: 'Report the codeword that the previous agent gave in its handoff, without looking anywhere else.',
              readOnly: true,
              reports: { handoff: 'off' },
              resultSchema: {
                type: 'object',
                required: ['codeword'],
                properties: { codeword: { type: 'string' } },
                additionalProperties: false,
              },
            },
          },
        ]);
        const finished = await until(run.id);
        assert.equal(finished.state, 'COMPLETED', JSON.stringify(finished));
        assert.deepEqual(finished.outcome, { data: { codeword: 'heliotrope' } });
        const listed = (await shift('artifact', 'list', run.id)) as unknown as Array<{
          id: string;
          role: string;
        }>;
        const roles = listed.map((artifact) => artifact.role);
        assert.equal(roles.filter((role) => role === 'handoff').length, 1, JSON.stringify(roles));
        assert.ok(roles.filter((role) => role === 'human_report').length >= 2);
        const handoff = listed.find((artifact) => artifact.role === 'handoff')!;
        const bytes = await runCli(['artifact', 'get', handoff.id, '--state-dir', state.path]);
        assert.match(bytes.output, /heliotrope/);
      });
      await t.test('an agent edits its worktree, never the project checkout', async () => {
        const run = await startAgent({
          goal: 'Append the line "omega" to notes.txt, then report {"done": true}.',
        });
        const finished = await until(run.id);
        assert.equal(finished.state, 'COMPLETED', JSON.stringify(finished));
        assert.match(await readFile(join(finished.workspace!.path, 'notes.txt'), 'utf8'), /omega/);
        assert.equal(await readFile(join(repo, 'notes.txt'), 'utf8'), 'alpha beta gamma\ndelta\n');
        assert.equal(
          execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }),
          '',
        );
      });
    } finally {
      await server.terminate();
      await state.remove();
    }
  },
);

test(
  'an owner goal runs in a real session, which survives the idle runtime stopping',
  { skip, timeout: 600_000 },
  async (t) => {
    const state = await temporaryState();
    t.after(() => state.remove());
    const repo = join(state.path, 'repo');
    await mkdir(repo);
    await writeFile(join(repo, 'notes.txt'), 'alpha beta\n');
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'],
      {
        cwd: repo,
      },
    );
    const server = await startChild(
      state.path,
      ['--opencode-model', model, '--opencode-environment', environment],
      {
        SHIFT_OPENCODE_IDLE_MS: '4000',
        ...(key === undefined ? {} : { SHIFT_OPENCODE_API_KEY: key }),
      },
    );
    t.after(() => server.terminate());
    const shift = async (...args: string[]): Promise<any> => {
      const result = await runCli([...args, '--state-dir', state.path]);
      if (result.code !== 0) throw new Error(`${result.errors}${result.output}`);
      return JSON.parse(result.output);
    };
    const project = await shift('project', 'add', '--path', repo);
    const file = join(state.path, 'workflow.json');
    await writeFile(
      file,
      JSON.stringify({
        nodes: [
          { id: 'start', type: 'manual_trigger' },
          {
            id: 'agent',
            type: 'agent',
            config: {
              goal: 'Count the words in notes.txt.',
              readOnly: true,
              reports: { handoff: 'off', humanReport: 'off' },
            },
          },
        ],
        connections: [
          {
            id: 'c1',
            fromNodeId: 'start',
            fromPort: 'success',
            toNodeId: 'agent',
            toPort: 'input',
          },
        ],
      }),
    );
    const workflow = await shift(
      'workflow',
      'create',
      '--project',
      project.id,
      '--name',
      'w',
      '--file',
      file,
    );
    await shift('workflow', 'publish', workflow.id);
    // The CLI helper has a short deadline, so long waits poll here instead of using --wait.
    let run = await shift('run', 'start', '--workflow', workflow.id);
    while (run.state === 'RUNNING') {
      await delay(1_000);
      run = await shift('run', 'show', run.id);
    }
    assert.equal(run.state, 'COMPLETED', JSON.stringify(run));
    const until = async (invocation: { id: string; state: string }) => {
      while (['PREPARING', 'SUBMITTING', 'RUNNING', 'UNCERTAIN'].includes(invocation.state)) {
        await delay(1_000);
        invocation = await shift('invocation', 'show', invocation.id);
      }
      return invocation as any;
    };
    const [session] = await shift('session', 'list');
    const remembered = await until(
      await shift(
        'session',
        'send',
        session.id,
        '--goal',
        'Remember the word "heliotrope" for my next message. Reply with only: ok',
      ),
    );
    assert.equal(remembered.state, 'COMPLETED', JSON.stringify(remembered));
    assert.equal(remembered.manual, true);
    // The runtime stops once idle, and the next goal starts it again.
    const started = () => server.output().split('OpenCode runtime started').length - 1;
    const runtimes = started();
    await eventually(
      () => (server.output().includes('Stopping the idle OpenCode runtime') ? true : undefined),
      30_000,
    );
    const recalled = await until(
      await shift(
        'session',
        'send',
        session.id,
        '--goal',
        'Which word did I ask you to remember? Reply with only that word.',
      ),
    );
    assert.equal(recalled.state, 'COMPLETED', JSON.stringify(recalled));
    assert.equal(started(), runtimes + 1, 'a new runtime generation');
    const shown = await shift('session', 'show', session.id);
    assert.equal(shown.harnessSessionId, session.harnessSessionId, 'the same conversation');
    const { entries } = await shift('session', 'transcript', session.id);
    const replies = entries.filter(
      (entry: { invocationId: string; kind: string }) =>
        entry.invocationId === recalled.id && entry.kind === 'assistant',
    );
    assert.match(replies.map((entry: { text: string }) => entry.text).join(' '), /heliotrope/i);
    assert.ok(
      entries.some(
        (entry: { invocationId: string; kind: string; text?: string }) =>
          entry.invocationId === remembered.id &&
          entry.kind === 'user' &&
          entry.text?.includes('heliotrope'),
      ),
    );
  },
);
