import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { runCli, startChild, temporaryState } from '../helpers.js';
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
    // Publishes a start -> agent -> end workflow with this agent configuration, then starts it.
    let projectId: string | undefined;
    const startAgent = async (agent: Record<string, unknown>) => {
      projectId ??= ((await shift('project', 'add', '--path', repo)) as unknown as { id: string })
        .id;
      const file = join(state.path, `workflow-${Date.now()}.json`);
      await writeFile(
        file,
        JSON.stringify({
          nodes: [
            { id: 'start', type: 'manual_trigger' },
            { id: 'agent', type: 'agent', config: agent },
            { id: 'end', type: 'end' },
          ],
          connections: [
            {
              id: 'c1',
              fromNodeId: 'start',
              fromPort: 'success',
              toNodeId: 'agent',
              toPort: 'input',
            },
            {
              id: 'c2',
              fromNodeId: 'agent',
              fromPort: 'success',
              toNodeId: 'end',
              toPort: 'input',
            },
          ],
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
