// Reproducible OpenCode v2 capability probe. Development tooling only: nothing here is imported by
// the server. Every run uses a private temporary HOME/XDG tree, a temporary Git repository and a
// private `opencode serve` process, then removes only the processes and files it verified as its own.
//
//   node apps/server/tools/opencode-probe/probe.mjs [--model opencode-go/claude-haiku-5-5]
//     [--auth-file ~/.local/share/opencode/auth.json] [--only case,case] [--out report.json] [--keep]
//
// Model cases need an API-key credential for the model's provider, read from SHIFT_PROBE_API_KEY or
// the auth file. OAuth entries are refused so the probe cannot rotate the owner's refresh token.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Ajv2020 } from 'ajv/dist/2020.js';

const { values: args } = parseArgs({
  options: {
    model: { type: 'string', default: 'opencode-go/claude-haiku-5-5' },
    'auth-file': { type: 'string', default: join(homedir(), '.local/share/opencode/auth.json') },
    opencode: { type: 'string', default: 'opencode' },
    only: { type: 'string' },
    out: { type: 'string' },
    keep: { type: 'boolean', default: false },
  },
});
const [providerID, ...modelParts] = args.model.split('/');
const model = { providerID, id: modelParts.join('/') };
assert.ok(model.id, '--model must be <provider>/<model>');
const only = args.only ? new Set(args.only.split(',')) : null;

const token = randomBytes(4).toString('hex');
const root = await mkdtemp(join(tmpdir(), 'shift-opencode-probe-'));
const paths = {
  home: join(root, 'home'),
  config: join(root, 'config'),
  repo: join(root, 'repo'),
  artifacts: join(root, 'artifacts'),
  plugin: join(root, 'plugin'),
  logs: join(root, 'logs'),
};
const env = {
  PATH: process.env.PATH,
  LANG: 'C.UTF-8',
  HOME: paths.home,
  XDG_DATA_HOME: join(root, 'data'),
  XDG_CONFIG_HOME: paths.config,
  XDG_CACHE_HOME: join(root, 'cache'),
  XDG_STATE_HOME: join(root, 'state'),
  TMPDIR: join(root, 'tmp'),
};
const report = {
  probe: 'opencode-v2-capabilities',
  startedAt: new Date().toISOString(),
  opencodeVersion: null,
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  model: args.model,
  cases: [],
  totalCostUSD: 0,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sanitize = (value) =>
  JSON.parse(
    JSON.stringify(value ?? null)
      .replaceAll(root, '<probe>')
      .replaceAll(token, '<token>'),
  );

// Raised when a case cannot reach the state it examines.
class Inconclusive extends Error {}

async function waitFor(what, predicate, timeoutMs = 90_000, intervalMs = 400) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(intervalMs);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function procInfo(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return {
      pid,
      ppid: Number(fields[1]),
      pgid: Number(fields[2]),
      cmd: (await readFile(`/proc/${pid}/cmdline`, 'utf8')).replaceAll('\0', ' ').trim(),
      cwd: await readlink(`/proc/${pid}/cwd`),
      environ: await readFile(`/proc/${pid}/environ`, 'utf8'),
    };
  } catch {
    return null;
  }
}

async function processes(predicate) {
  const found = [];
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    const info = await procInfo(Number(name));
    if (info && predicate(info)) found.push(info);
  }
  return found;
}

// A case-specific process is ours only if its cwd is inside the probe tree and its command carries
// the marker.
const ownedProcesses = (marker) =>
  processes((info) => info.cmd.includes(marker) && info.cwd.startsWith(root));

// Everything the namespace started inherits its private XDG_DATA_HOME, including untagged tool
// children such as `sleep`. Members of a marked tool's process group are included as well.
async function namespaceProcesses() {
  const inherited = `XDG_DATA_HOME=${env.XDG_DATA_HOME}`;
  const marked = await ownedProcesses(token);
  const groups = new Set(marked.map((info) => info.pgid));
  return processes(
    (info) =>
      info.environ.split('\0').includes(inherited) ||
      (groups.has(info.pgid) && info.cwd.startsWith(root)),
  );
}

// ---------------------------------------------------------------------------------------------
// Shift-side result validator, called by the probe plugin's shift_submit_result tool.

const ajv = new Ajv2020({ allErrors: true, strict: true });
const contracts = new Map();
const validator = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const call = JSON.parse(body);
  const contract = contracts.get(call.sessionID);
  let verdict = { accepted: false, reason: 'no Shift invocation is active for this session' };
  if (contract) {
    contract.calls.push(call);
    const { status, data, blocker, error } = call.input ?? {};
    if (contract.forceFirstRejection && contract.calls.length === 1) {
      verdict = { accepted: false, reason: 'probe forced rejection; resubmit the same result' };
    } else if (status === 'completed' && !contract.validate(data ?? null)) {
      verdict = { accepted: false, reason: `data ${ajv.errorsText(contract.validate.errors)}` };
    } else if (status === 'blocked' && !blocker) {
      verdict = {
        accepted: false,
        reason: 'blocked results need blocker.code and blocker.message',
      };
    } else if (status === 'failed' && !error) {
      verdict = { accepted: false, reason: 'failed results need error.code and error.message' };
    } else {
      verdict = { accepted: true };
    }
    call.verdict = verdict;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(verdict));
});
await new Promise((resolve) => validator.listen(0, '127.0.0.1', resolve));
const callbackURL = `http://127.0.0.1:${validator.address().port}/result`;

// ---------------------------------------------------------------------------------------------
// Private OpenCode server lifecycle.

const harness = {
  child: null,
  url: null,
  auth: null,
  starts: 0,
  stream: null,
  async start() {
    const port = await freePort();
    const log = join(paths.logs, `serve-${++this.starts}.log`);
    const child = spawn(
      args.opencode,
      ['serve', '--hostname', '127.0.0.1', '--port', String(port)],
      {
        cwd: paths.repo,
        env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.exited = new Promise((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal })),
    );
    let output = '';
    const collect = (chunk) => {
      output += chunk;
      appendFile(log, chunk).catch(() => {});
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    this.child = child;
    const password = await waitFor(
      'server password',
      () => /server password (\S+)/.exec(output)?.[1],
      30_000,
      100,
    );
    this.url = `http://127.0.0.1:${port}`;
    this.auth = {
      authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
    };
    await waitFor(
      'server info',
      async () => (await this.api('GET', '/api/info')).status === 200,
      30_000,
      200,
    );
    this.stream = await this.subscribe();
  },
  async owned() {
    const info = this.child && (await procInfo(this.child.pid));
    return info?.environ.split('\0').includes(`XDG_DATA_HOME=${env.XDG_DATA_HOME}`) ? info : null;
  },
  // Signal only the server process, not its group, so the probe can observe orphaned tool processes.
  // Remaining members of the dead server's own process group are recorded, then reaped.
  async signal(name) {
    assert.ok(await this.owned(), 'refusing to signal a process the probe did not start');
    this.stream?.close();
    const { pid } = this.child;
    process.kill(pid, name);
    const exit = await this.child.exited;
    const survivors = [];
    for (const entry of await readdir('/proc')) {
      const info = /^\d+$/.test(entry) ? await procInfo(Number(entry)) : null;
      if (info?.pgid === pid) survivors.push(info.cmd.split(' ')[0]);
    }
    if (survivors.length) process.kill(-pid, 'SIGKILL');
    return { ...exit, serverGroupSurvivors: survivors };
  },
  // The deadline also covers reading the body, so a stalled response cannot outlast a case timeout.
  async api(method, path, body, timeoutMs = 30_000) {
    const signal = AbortSignal.timeout(timeoutMs);
    const response = await fetch(`${this.url}${path}`, {
      method,
      headers: { ...this.auth, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: response.status, json };
  },
  async subscribe(headers = {}) {
    const controller = new AbortController();
    const response = await fetch(`${this.url}/api/event`, {
      headers: { ...this.auth, ...headers },
      signal: controller.signal,
    });
    const events = [];
    const lines = { id: 0 };
    (async () => {
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end).split('\n');
            buffer = buffer.slice(end + 2);
            if (block.some((line) => line.startsWith('id:'))) lines.id++;
            const data = block
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim());
            if (data.length) events.push(JSON.parse(data.join('\n')));
          }
        }
      } catch {}
    })();
    return { events, lines, close: () => controller.abort() };
  },
};

// ---------------------------------------------------------------------------------------------
// Session helpers.

async function createSession(suffix, extra = {}) {
  const id = `ses_shiftprobe${token}${suffix}`;
  const created = await harness.api('POST', '/api/session', {
    id,
    agent: 'build',
    model,
    location: { directory: paths.repo },
    ...extra,
  });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  return id;
}

async function prompt(sessionID, suffix, text, extra = {}) {
  const id = `msg_shiftprobe${token}${suffix}`;
  const ack = await harness.api('POST', `/api/session/${sessionID}/prompt`, { id, text, ...extra });
  assert.equal(ack.status, 200, JSON.stringify(ack.json));
  return { id, ack: ack.json.data };
}

const isActive = async (sessionID) =>
  Boolean((await harness.api('GET', '/api/session/active')).json.data[sessionID]);
const messageExists = async (sessionID, id) =>
  (await harness.api('GET', `/api/session/${sessionID}/message/${id}`)).status === 200;

async function settle(sessionID, messageID, timeoutMs = 120_000) {
  await waitFor(`delivery of ${messageID}`, () => messageExists(sessionID, messageID), timeoutMs);
  let quiet = 0;
  await waitFor(
    `${sessionID} to go idle`,
    async () => ((quiet = (await isActive(sessionID)) ? 0 : quiet + 1) >= 3 ? true : false),
    timeoutMs,
    500,
  );
}

async function messages(sessionID) {
  const result = await harness.api('GET', `/api/session/${sessionID}/message?order=asc&limit=200`);
  return result.json.data;
}

const tools = (list) =>
  list.flatMap((message) => (message.content ?? []).filter((part) => part.type === 'tool'));
const replies = (list) =>
  list
    .filter((message) => message.type === 'assistant')
    .flatMap((message) => message.content.filter((part) => part.type === 'text'))
    .map((part) => part.text)
    .join('\n');
const shape = (list) =>
  list.map((message) => ({
    type: message.type,
    outcome: message.outcome,
    finish: message.finish,
    error: message.error?.type,
    tools: tools([message]).map((tool) => ({
      name: tool.name,
      status: tool.state.status,
      error: tool.state.error?.type,
    })),
  }));

const inbox = async (sessionID) =>
  (await harness.api('GET', `/api/session/${sessionID}/inbox`)).json.data;

// ---------------------------------------------------------------------------------------------
// Cases. Each asserts the behavior the capability document records, so a changed OpenCode version
// fails loudly instead of silently invalidating adapter assumptions.

const cases = [];
const probeCase = (name, needsModel, run) => cases.push({ name, needsModel, run });
const shared = {};

probeCase('session-identity', false, async () => {
  const id = await createSession('ident', {
    title: 'first',
    metadata: { shift: { sessionId: 'S-1' } },
  });
  const again = await harness.api('POST', '/api/session', { id, title: 'second' });
  assert.equal(again.status, 200);
  assert.equal(again.json.data.id, id);
  assert.equal(
    again.json.data.title,
    'first',
    'repeat create returns the existing session unchanged',
  );
  assert.deepEqual(again.json.data.metadata, { shift: { sessionId: 'S-1' } });
  return {
    suppliedId: true,
    repeatCreate: 'returns existing session; new fields ignored, no conflict',
  };
});

probeCase('prompt-ack-and-transcript', true, async () => {
  const sessionID = await createSession('turn');
  const { id, ack } = await prompt(
    sessionID,
    'turn',
    `Reply with exactly PONG-${token} and nothing else. Do not use tools.`,
    {
      metadata: { shift: { invocationId: 'I-1' } },
    },
  );
  assert.equal(ack.id, id, 'acknowledgement echoes the supplied message id');
  assert.equal(ack.type, 'user');
  await settle(sessionID, id);
  const list = await messages(sessionID);
  const user = list.find((message) => message.id === id);
  assert.deepEqual(user.metadata, { shift: { invocationId: 'I-1' } });
  assert.match(replies(list), new RegExp(`PONG-${token}`));
  assert.equal(list.at(-1).type, 'idle');
  assert.equal(list.at(-1).outcome, 'succeeded');
  const durable = harness.stream.events.filter((event) => event.durable?.aggregateID === sessionID);
  const seqs = durable.map((event) => event.durable.seq);
  assert.deepEqual(
    seqs,
    [...seqs].sort((a, b) => a - b),
    'durable seq increases per session',
  );
  shared.turnSession = sessionID;
  return {
    ack: { id: 'supplied', type: ack.type, delivery: ack.delivery },
    transcript: shape(list),
    durableEventTypes: [...new Set(durable.map((event) => event.type))],
  };
});

probeCase('prompt-id-dedup', true, async () => {
  const sessionID = shared.turnSession;
  assert.ok(sessionID, 'requires prompt-ack-and-transcript');
  const before = await messages(sessionID);
  const cost = (await harness.api('GET', `/api/session/${sessionID}`)).json.data.cost;
  const { ack } = await prompt(sessionID, 'turn', 'A different text with the same message id.');
  assert.match(ack.payload.text, /PONG/, 'acknowledgement returns the originally stored message');
  await sleep(1500);
  await waitFor('idle', async () => !(await isActive(sessionID)));
  const after = await messages(sessionID);
  const nonIdle = (list) => list.filter((message) => message.type !== 'idle');
  assert.equal(nonIdle(after).length, nonIdle(before).length, 'no new user or assistant message');
  assert.equal((await harness.api('GET', `/api/session/${sessionID}`)).json.data.cost, cost);
  return {
    duplicateIdBehavior: 'original message returned, no model call',
    extraIdleRecords: after.length - before.length,
  };
});

probeCase('structured-result-correction', true, async () => {
  await waitFor(
    'probe plugin activation',
    async () =>
      (await harness.api('GET', '/api/plugin')).json.data.some(
        (plugin) => plugin.id === 'shift-probe' && plugin.state.status === 'active',
      ),
    30_000,
  );
  const sessionID = await createSession('result');
  const contract = {
    calls: [],
    forceFirstRejection: true,
    validate: ajv.compile({
      type: 'object',
      properties: {
        summary: { type: 'string', minLength: 1 },
        wordCount: { type: 'integer', minimum: 0 },
      },
      required: ['summary', 'wordCount'],
      additionalProperties: false,
    }),
  };
  contracts.set(sessionID, contract);
  const { id } = await prompt(
    sessionID,
    'result',
    'Read README.md. Then call the shift_submit_result tool with status "completed" and data ' +
      '{"summary": <one sentence>, "wordCount": <number of words in README.md>}. If Shift rejects ' +
      'the result, correct it and call the tool again. Do not put the result in a text reply.',
  );
  await settle(sessionID, id);
  const list = await messages(sessionID);
  const submissions = tools(list).filter((tool) => tool.name === 'shift_submit_result');
  assert.ok(contract.calls.length >= 2, 'model resubmitted after rejection within the same turn');
  assert.equal(contract.calls[0].verdict.accepted, false);
  assert.equal(contract.calls.at(-1).verdict.accepted, true);
  const accepted = contract.calls.at(-1).input;
  assert.equal(accepted.status, 'completed', 'a blocked or failed result is not a completion');
  assert.ok(contract.validate(accepted.data), 'accepted data satisfies the business schema');
  assert.equal(
    submissions.length,
    contract.calls.length,
    'each call is a direct tool part in the transcript',
  );
  assert.equal(submissions[0].state.status, 'error');
  assert.equal(submissions.at(-1).state.status, 'completed');
  assert.deepEqual(submissions.at(-1).state.input, contract.calls.at(-1).input);
  const assistantIds = new Set(list.map((message) => message.id));
  assert.ok(
    contract.calls.every(
      (call) => call.sessionID === sessionID && assistantIds.has(call.messageID),
    ),
  );
  assert.ok(contract.calls.every((call) => submissions.some((tool) => tool.id === call.callID)));
  return {
    calls: contract.calls.map((call) => ({
      status: call.input.status,
      accepted: call.verdict.accepted,
    })),
    acceptedInput: contract.calls.at(-1).input,
    callbackContext: 'sessionID, assistant messageID and tool call id match the transcript',
    transcript: shape(list),
  };
});

probeCase('structured-blocker', true, async () => {
  const sessionID = await createSession('blocker');
  const contract = { calls: [], validate: ajv.compile({ type: 'object' }) };
  contracts.set(sessionID, contract);
  const { id } = await prompt(
    sessionID,
    'blocker',
    'Read input/spec.md and summarize it. If that file does not exist, do not guess: call ' +
      'shift_submit_result with status "blocked" and blocker {"code": "MISSING_INPUT", "message": <why>}.',
  );
  await settle(sessionID, id);
  const accepted = contract.calls.find((call) => call.verdict.accepted);
  assert.equal(accepted?.input.status, 'blocked');
  assert.equal(accepted.input.blocker.code, 'MISSING_INPUT');
  return { accepted: accepted.input, transcript: shape(await messages(sessionID)) };
});

probeCase('edit-deny-shell-bypass', true, async () => {
  const file = `bypass-${token}.txt`;
  const sessionID = await createSession('bypass', {
    permissions: [{ action: 'edit', resource: '*', effect: 'deny' }],
  });
  const { id } = await prompt(
    sessionID,
    'bypass',
    `Create a file named ${file} containing HELLO. Use any tool that works.`,
  );
  await settle(sessionID, id);
  assert.ok(
    existsSync(join(paths.repo, file)),
    'edit deny alone does not prevent repository writes',
  );
  return { fileWritten: true, transcript: shape(await messages(sessionID)) };
});

probeCase('read-only-policy', true, async () => {
  const file = `policy-${token}.txt`;
  const artifact = join(paths.artifacts, 'report.md');
  const sessionID = await createSession('policy', {
    permissions: [
      { action: 'edit', resource: '*', effect: 'deny' },
      { action: 'edit', resource: `${paths.artifacts}/*`, effect: 'allow' },
      { action: 'shell', resource: '*', effect: 'deny' },
      { action: 'question', resource: '*', effect: 'deny' },
      { action: 'read', resource: '*.env', effect: 'deny' },
      { action: 'read', resource: '*.env.*', effect: 'deny' },
    ],
  });
  const { id } = await prompt(
    sessionID,
    'policy',
    `First write the file ${artifact} containing "report". Then try to create ${file} in the ` +
      'current repository containing HELLO, using any tool. Then reply with what succeeded.',
  );
  await settle(sessionID, id);
  const list = await messages(sessionID);
  assert.ok(!existsSync(join(paths.repo, file)), 'repository write was prevented');
  assert.ok(existsSync(artifact), 'artifact-directory write was allowed');
  return { repositoryWrite: 'prevented', artifactWrite: 'allowed', transcript: shape(list) };
});

probeCase('permission-ask', true, async () => {
  const file = `ask-${token}.txt`;
  const sessionID = await createSession('ask', {
    permissions: [
      { action: 'edit', resource: '*', effect: 'deny' },
      { action: 'shell', resource: '*', effect: 'ask' },
    ],
  });
  const { id } = await prompt(
    sessionID,
    'ask',
    `Create a file named ${file} containing HELLO using the shell.`,
  );
  const request = await waitFor('permission request', async () => {
    const result = await harness.api('GET', `/api/session/${sessionID}/permission`);
    return result.json.data[0];
  });
  assert.ok(await isActive(sessionID), 'turn stays running while the request is pending');
  const reply = await harness.api(
    'POST',
    `/api/session/${sessionID}/permission/${request.id}/reply`,
    {
      decision: 'reject',
      message: 'Shell is not permitted in this node.',
    },
  );
  assert.equal(reply.status, 204);
  await settle(sessionID, id);
  const list = await messages(sessionID);
  assert.ok(!existsSync(join(paths.repo, file)));
  assert.ok(tools(list).some((tool) => tool.state.error?.type === 'permission.rejected'));
  return {
    request: {
      action: request.action,
      resources: request.resources,
      save: request.save,
      source: request.source?.type,
    },
    transcript: shape(list),
  };
});

probeCase('question-form', true, async () => {
  const sessionID = await createSession('question');
  const { id } = await prompt(
    sessionID,
    'question',
    'Use your question tool to ask the user whether they prefer red or blue, wait for the answer, then reply with it.',
  );
  const form = await waitFor('question form', async () => {
    const result = await harness.api('GET', `/api/session/${sessionID}/form`);
    return result.json.data[0];
  });
  assert.equal(form.metadata?.kind, 'question');
  assert.ok(await isActive(sessionID), 'turn blocks on the form');
  const cancel = await harness.api('DELETE', `/api/session/${sessionID}/form/${form.id}`);
  await settle(sessionID, id);
  const list = await messages(sessionID);
  const outcome = (await harness.api('GET', `/api/session/${sessionID}`)).json.data.outcome ?? null;
  const assistant = list.findLast((message) => message.type === 'assistant');
  assert.equal(cancel.status, 204);
  assert.ok(!list.some((message) => message.type === 'idle'), 'dismissal writes no idle record');
  assert.equal(outcome, null, 'dismissal leaves the session outcome unset');
  assert.equal(assistant.finish, 'error');
  assert.equal(assistant.error?.type, 'aborted');
  return {
    form: { kind: form.metadata.kind, fields: form.fields.map((field) => field.type) },
    idleRecordWritten: false,
    sessionOutcome: outcome,
    assistant: { finish: assistant.finish, error: assistant.error.type },
    transcript: shape(list),
  };
});

probeCase('interrupt-active-tool', true, async () => {
  const marker = `interrupt-${token}`;
  const sessionID = await createSession('interrupt');
  const { id } = await prompt(
    sessionID,
    'interrupt',
    `Run the shell command \`sleep 30 && echo done > ${marker}.txt\` and wait for it. Then reply DONE.`,
  );
  const [shell] = await waitFor('tool process', async () => {
    const found = await ownedProcesses(marker);
    return found.length ? found : null;
  });
  // Cleanup relies on untagged tool children being attributable to the namespace.
  const child = await waitFor('untagged tool child', async () =>
    (await namespaceProcesses()).find((info) => info.cmd === 'sleep 30'),
  );
  const queued = await prompt(sessionID, 'interrupt2', 'After that, reply SECOND.');
  const interrupted = await harness.api('POST', `/api/session/${sessionID}/interrupt`);
  assert.deepEqual(interrupted.json, { interrupted: true });
  await settle(sessionID, id);
  await waitFor(
    'tool process exit',
    async () => (await ownedProcesses(marker)).length === 0,
    5_000,
  );
  const list = await messages(sessionID);
  assert.equal(list.at(-1).outcome, 'interrupted');
  assert.ok(tools(list).some((tool) => tool.state.error?.type === 'aborted'));
  const pending = await inbox(sessionID);
  assert.ok(
    pending.some((item) => item.id === queued.id),
    'queued input survives the interrupt',
  );
  const cancel = await harness.api('DELETE', `/api/session/${sessionID}/inbox/${queued.id}`);
  assert.equal((await inbox(sessionID)).length, 0);
  await sleep(1500);
  assert.equal(await isActive(sessionID), false);
  assert.ok(!existsSync(join(paths.repo, `${marker}.txt`)));
  return {
    interruptResponse: interrupted.json,
    toolProcessGroupSeparateFromServer: shell.pgid !== harness.child.pid,
    toolChildInheritsNamespaceEnvironment: child.environ.includes(env.XDG_DATA_HOME),
    queuedInputAfterInterrupt: 'retained in inbox until explicitly cancelled',
    inboxCancelStatus: cancel.status,
    transcript: shape(list),
  };
});

probeCase('event-replay', false, async () => {
  const cursor = harness.stream.events.findLast(
    (event) => event.id && event.type !== 'server.connected',
  );
  assert.ok(cursor, 'requires earlier events on this server');
  // Produce an event after the cursor so a replaying server would have something to resend.
  const sessionID = await createSession('replay');
  const newer = await waitFor(
    'event after the cursor',
    () =>
      harness.stream.events.find(
        (event) => event.type === 'session.created' && event.data?.sessionID === sessionID,
      ),
    10_000,
    100,
  );
  const replay = await harness.subscribe({ 'last-event-id': cursor.id });
  await sleep(1500);
  replay.close();
  assert.ok(
    !replay.events.some((event) => event.id === newer.id),
    'an event after Last-Event-ID is not replayed',
  );
  assert.equal(harness.stream.lines.id, 0, 'the live stream sends no SSE id fields');
  assert.equal(replay.lines.id, 0);
  return {
    replayedEvents: replay.events.filter((event) => event.type !== 'server.connected').length,
    sseIdFields: 0,
    durableEnvelope:
      'session events carry durable {aggregateID, seq}; the stream itself is live-only',
  };
});

probeCase('idle-shutdown-resume', true, async () => {
  const sessionID = shared.turnSession;
  assert.ok(sessionID, 'requires prompt-ack-and-transcript');
  assert.equal(await isActive(sessionID), false);
  const exit = await harness.signal('SIGTERM');
  await harness.start();
  const { id } = await prompt(
    sessionID,
    'resume',
    'Without using tools, repeat exactly the word you replied with in your first reply.',
  );
  await settle(sessionID, id);
  const list = await messages(sessionID);
  const reply = replies(list.slice(list.findIndex((message) => message.id === id)));
  assert.match(reply, new RegExp(`PONG-${token}`));
  return { exit, contextAfterRestart: 'preserved' };
});

probeCase('crash-after-ack', true, async () => {
  // The kill races delivery. Retry with fresh sessions until it lands before delivery.
  const attempts = [];
  let sessionID, id, exit, stranded;
  for (let attempt = 1; attempt <= 3 && !stranded; attempt++) {
    sessionID = await createSession(`ack${attempt}`);
    ({ id } = await prompt(sessionID, `ack${attempt}`, `Reply with exactly ACK-${token}.`));
    exit = await harness.signal('SIGKILL');
    await harness.start();
    const lookup = (await harness.api('GET', `/api/session/${sessionID}/message/${id}`)).status;
    attempts.push({ attempt, messageLookup: lookup });
    if (lookup === 404) {
      stranded = { inInbox: (await inbox(sessionID)).some((item) => item.id === id) };
    }
  }
  if (!stranded) {
    throw new Inconclusive(
      `kill landed after delivery in all attempts: ${JSON.stringify(attempts)}`,
    );
  }
  await sleep(3000);
  stranded.activeAfterRestart = await isActive(sessionID);
  assert.equal(stranded.inInbox, true, 'acknowledged prompt is durable');
  assert.equal(stranded.activeAfterRestart, false, 'restart does not deliver stranded inbox items');
  const resubmit = await harness.api('POST', `/api/session/${sessionID}/prompt`, {
    id,
    text: `Reply with exactly ACK-${token}.`,
  });
  assert.equal(resubmit.status, 200);
  await settle(sessionID, id);
  const list = await messages(sessionID);
  assert.equal(list.filter((message) => message.type === 'user').length, 1);
  assert.equal(list.filter((message) => message.type === 'assistant').length, 1);
  assert.match(replies(list), new RegExp(`ACK-${token}`));
  return {
    exit,
    attempts,
    stranded,
    resubmitSameId: 'delivered exactly once',
    transcript: shape(list),
  };
});

probeCase('crash-during-tool', true, async () => {
  const marker = `crash-${token}`;
  const sessionID = await createSession('crash');
  await prompt(
    sessionID,
    'crash',
    `Run the shell command \`sleep 8 && echo done > ${marker}.txt\` and wait for it. Then reply DONE.`,
  );
  await waitFor('tool process', async () => (await ownedProcesses(marker)).length > 0);
  const serverPid = harness.child.pid;
  const exit = await harness.signal('SIGKILL');
  const orphans = await ownedProcesses(marker);
  assert.ok(orphans.length > 0, 'tool process outlives the killed server');
  assert.ok(orphans.every((orphan) => orphan.ppid !== serverPid));
  await harness.start();
  const afterRestart = await messages(sessionID);
  assert.equal(await isActive(sessionID), false);
  assert.ok(
    tools(afterRestart).some((tool) => tool.state.status === 'running'),
    'stale running tool remains',
  );
  assert.ok(!afterRestart.some((message) => message.type === 'idle'));
  await waitFor(
    'orphaned effect',
    async () => existsSync(join(paths.repo, `${marker}.txt`)),
    20_000,
  );
  const { id } = await prompt(
    sessionID,
    'crash2',
    `Without retrying anything, reply EXISTS if ${marker}.txt exists in the repository, otherwise MISSING.`,
  );
  await settle(sessionID, id);
  const list = await messages(sessionID);
  const stale = tools(list)[0];
  assert.equal(stale.state.status, 'error');
  assert.equal(stale.state.error.type, 'aborted');
  return {
    exit,
    orphanedToolProcess: true,
    afterRestart: shape(afterRestart),
    effectCompletedAfterCrash: true,
    staleToolRelabelledOnNextTurn: stale.state.error,
    transcript: shape(list),
  };
});

// ---------------------------------------------------------------------------------------------
// Setup, execution, report and verified cleanup.

async function credentialKey() {
  if (providerID === 'opencode') return null;
  if (process.env.SHIFT_PROBE_API_KEY) return process.env.SHIFT_PROBE_API_KEY;
  try {
    const entry = JSON.parse(await readFile(args['auth-file'], 'utf8'))[providerID];
    if (entry?.type === 'api' && entry.key) return entry.key;
  } catch {}
  return undefined;
}

let exitCode = 0;
try {
  for (const dir of Object.values(paths)) await mkdir(dir, { recursive: true });
  await mkdir(env.TMPDIR, { recursive: true });
  await cp(join(dirname(fileURLToPath(import.meta.url)), 'plugin'), paths.plugin, {
    recursive: true,
  });
  await mkdir(join(paths.config, 'opencode'), { recursive: true });
  await writeFile(
    join(paths.config, 'opencode', 'opencode.jsonc'),
    JSON.stringify(
      { plugins: [{ package: paths.plugin, options: { callback: callbackURL } }] },
      null,
      2,
    ),
  );
  await writeFile(join(paths.repo, 'README.md'), 'hi\n');
  const git = (...gitArgs) =>
    execFileSync('git', gitArgs, { cwd: paths.repo, env, stdio: 'ignore' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=probe', '-c', 'user.email=probe@localhost', 'commit', '-qm', 'init');
  report.opencodeVersion = execFileSync(args.opencode, ['--version'], { env }).toString().trim();

  await harness.start();
  const key = await credentialKey();
  const modelAvailable = key !== undefined;
  if (key) {
    const created = await harness.api('POST', '/api/credential', {
      integrationID: providerID,
      label: 'shift-probe',
      value: { type: 'key', key },
      activate: true,
    });
    assert.equal(created.status, 200, 'credential registration failed');
  }

  for (const { name, needsModel, run } of cases) {
    if (only && !only.has(name)) continue;
    if (needsModel && !modelAvailable) {
      report.cases.push({
        name,
        result: 'skipped',
        reason: `no API-key credential for ${providerID}`,
      });
      continue;
    }
    const started = Date.now();
    try {
      const evidence = await run();
      report.cases.push({
        name,
        result: 'observed',
        ms: Date.now() - started,
        evidence: sanitize(evidence),
      });
    } catch (error) {
      // An inconclusive case did not reach the state it examines; it is never reported as observed.
      exitCode = 1;
      report.cases.push({
        name,
        result: error instanceof Inconclusive ? 'inconclusive' : 'failed',
        ms: Date.now() - started,
        error: sanitize(error.message),
      });
      if (!(await harness.owned())) await harness.start();
    }
    console.error(`${report.cases.at(-1).result.padEnd(8)} ${name}`);
  }

  const sessions = (await harness.api('GET', '/api/session')).json?.data ?? [];
  report.totalCostUSD = Number(
    sessions.reduce((sum, session) => sum + (session.cost ?? 0), 0).toFixed(6),
  );
} catch (error) {
  exitCode = 1;
  report.fatal = sanitize(error.stack ?? String(error));
} finally {
  harness.stream?.close();
  if (await harness.owned()) {
    process.kill(-harness.child.pid, 'SIGKILL');
    await harness.child.exited;
  }
  // Kill every namespace process, including untagged tool children, and wait for them to exit.
  let remaining = [];
  try {
    remaining = await waitFor(
      'namespace processes to exit',
      async () => {
        const alive = await namespaceProcesses();
        for (const info of alive) {
          try {
            process.kill(info.pid, 'SIGKILL');
          } catch {}
        }
        return alive.length === 0 ? [] : null;
      },
      5_000,
      200,
    );
  } catch {
    remaining = await namespaceProcesses();
    exitCode = 1;
  }
  await new Promise((resolve) => validator.close(resolve));
  report.finishedAt = new Date().toISOString();
  report.cleanup = {
    remainingProbeProcesses: remaining.length,
    keptDirectory: args.keep,
  };
  if (args.keep) report.directory = root;
  else await rm(root, { recursive: true, force: true });
  const output = JSON.stringify(report, null, 2);
  if (args.out) await writeFile(args.out, `${output}\n`);
  else console.log(output);
}
process.exit(exitCode);
