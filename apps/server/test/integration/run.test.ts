import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { runCli, startChild, temporaryState } from '../helpers.js';

// `shift serve` driving real OpenCode, with paid model calls: opt in with SHIFT_TEST_OPENCODE=1.
// The key comes from SHIFT_TEST_OPENCODE_KEY or an API-key entry in the OpenCode auth file.
const model = process.env['SHIFT_TEST_OPENCODE_MODEL'] ?? 'opencode-go/claude-haiku-5-5';
const provider = model.slice(0, model.indexOf('/'));

async function credentialKey(): Promise<string | undefined> {
  if (process.env['SHIFT_TEST_OPENCODE_KEY']) return process.env['SHIFT_TEST_OPENCODE_KEY'];
  try {
    const auth = JSON.parse(
      await readFile(join(homedir(), '.local/share/opencode/auth.json'), 'utf8'),
    ) as Record<string, { type?: string; key?: string }>;
    return auth[provider]?.type === 'api' ? auth[provider]?.key : undefined;
  } catch {
    return undefined;
  }
}

const key = process.env['SHIFT_TEST_OPENCODE'] === '1' ? await credentialKey() : undefined;
const skip =
  process.env['SHIFT_TEST_OPENCODE'] !== '1'
    ? 'set SHIFT_TEST_OPENCODE=1 to run real OpenCode model calls'
    : key === undefined && `no API-key credential for ${provider}`;

interface Run {
  id: string;
  state: string;
  outcome: unknown;
  attention: { code: string } | null;
  invocations: Array<{ kind: string; state: string }>;
}

async function toolProcess(stateDirectory: string): Promise<number> {
  for (let attempt = 0; attempt < 240; attempt++) {
    for (const entry of await readdir('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const environ = await readFile(`/proc/${entry}/environ`, 'utf8');
        const command = await readFile(`/proc/${entry}/cmdline`, 'utf8');
        if (
          command.startsWith('sleep\0') &&
          environ.includes(`XDG_DATA_HOME=${stateDirectory}/harness/opencode/data`)
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
    execFileSync('git', ['init', '-q'], { cwd: repo });
    const serve = () =>
      startChild(state.path, ['--opencode-model', model], { SHIFT_OPENCODE_API_KEY: key! });
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
    let server = await serve();
    try {
      await t.test('a read-only run completes with a schema-valid result', async () => {
        const run = await shift(
          'run',
          'start',
          '--repo',
          repo,
          '--read-only',
          '--goal',
          'Count the words in notes.txt.',
          '--result-schema',
          '{"type":"object","required":["words"],"properties":{"words":{"type":"integer"}},"additionalProperties":false}',
        );
        const finished = await until(run.id);
        assert.equal(finished.state, 'COMPLETED', JSON.stringify(finished));
        assert.deepEqual(finished.outcome, { data: { words: 4 } });
      });

      await t.test(
        'killing Shift mid-tool kills the tool and reports an unknown outcome',
        async () => {
          const run = await shift(
            'run',
            'start',
            '--repo',
            repo,
            '--goal',
            'Run the shell command `sleep 15 && echo done > crash-marker.txt` and wait for it. Then report {"done": true}.',
          );
          const tool = await toolProcess(state.path);
          await server.terminate('SIGKILL');
          server = await serve();
          const finished = await until(run.id);
          assert.equal(finished.state, 'NEEDS_HUMAN', JSON.stringify(finished));
          assert.equal(finished.attention?.code, 'HARNESS_OUTCOME_UNKNOWN');
          assert.equal(existsSync(`/proc/${tool}`), false);
          await delay(16_000);
          assert.equal(
            existsSync(join(repo, 'crash-marker.txt')),
            false,
            'the effect never happened',
          );
        },
      );
    } finally {
      await server.terminate();
      await state.remove();
    }
  },
);
