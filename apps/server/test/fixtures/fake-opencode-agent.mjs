#!/usr/bin/env node
// A scripted OpenCode v2 stand-in for end-to-end run tests. It implements the session routes the
// adapter uses, persists sessions across restarts like OpenCode's database, and runs each prompt as
// a turn driven by directives in its text:
//   [fake-delay MS]   wait before the first assistant step (accepted, no effects yet)
//   [fake-work MS]    run a detached `sleep` tool process for MS milliseconds
//   [fake-result {…}] submit this envelope through the Shift plugin endpoint
//   [fake-no-result]  end the turn without submitting
// A turn interrupted by a crash keeps its running tool and no idle record, as OpenCode does.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const password = randomBytes(12).toString('hex');
const expected = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
const stateFile = join(process.env.XDG_DATA_HOME, 'fake-sessions.json');
const config = JSON.parse(
  readFileSync(join(process.env.XDG_CONFIG_HOME, 'opencode', 'opencode.jsonc'), 'utf8'),
);
const { url: resultUrl, token } = config.plugins[0].options;
const state = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, 'utf8'))
  : { sessions: {} };
const save = () => writeFileSync(stateFile, JSON.stringify({ ...state, pid: process.pid }));
const active = new Map(); // sessionID -> { abort(), tool }
let counter = 0;
const id = (prefix) => `${prefix}_${Date.now().toString(36)}${(++counter).toString(36)}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
save();

function publicSession(session) {
  const { messages, inbox, ...rest } = session;
  return rest;
}

async function runTurn(session, prompt) {
  const text = prompt.text;
  let aborted = false;
  const control = { abort: () => (aborted = true), tool: null };
  active.set(session.id, control);
  const delay = Number(/\[fake-delay (\d+)\]/.exec(text)?.[1] ?? 0);
  const work = Number(/\[fake-work (\d+)\]/.exec(text)?.[1] ?? 0);
  const result = /\[fake-result (\{.*?\})\]/.exec(text)?.[1];
  const finish = (outcome) => {
    active.delete(session.id);
    session.messages.push({ id: id('msg'), type: 'idle', outcome });
    save();
  };
  await sleep(delay);
  if (aborted) return;
  const assistant = { id: id('msg'), type: 'assistant', content: [] };
  session.messages.push(assistant);
  save();
  if (work > 0) {
    const part = { type: 'tool', name: 'shell', state: { status: 'running' } };
    assistant.content.push(part);
    const tool = spawn('sleep', [String(work / 1000)], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, OPENCODE_SESSION_ID: session.id },
    });
    control.tool = tool;
    state.lastToolPid = tool.pid;
    save();
    const exit = await new Promise((resolve) => tool.once('exit', (code) => resolve(code)));
    if (aborted) {
      part.state = { status: 'error', error: { type: 'aborted' } };
      assistant.finish = 'error';
      assistant.error = { type: 'aborted' };
      return finish('interrupted');
    }
    part.state = { status: exit === 0 ? 'completed' : 'error' };
    save();
  }
  if (!/\[fake-no-result\]/.test(text)) {
    const call = { type: 'tool', name: 'shift_submit_result', state: { status: 'running' } };
    assistant.content.push(call);
    try {
      const response = await fetch(resultUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sessionID: session.id,
          messageID: assistant.id,
          callID: id('call'),
          input: result ? JSON.parse(result) : { status: 'completed', data: {} },
        }),
      });
      call.state = { status: (await response.json()).accepted ? 'completed' : 'error' };
    } catch {
      call.state = { status: 'error' };
    }
  }
  if (aborted) {
    assistant.finish = 'error';
    assistant.error = { type: 'aborted' };
    return finish('interrupted');
  }
  assistant.finish = 'stop';
  finish('succeeded');
}

function deliver(session, item) {
  // A new prompt relabels tools a crash left running, as OpenCode does.
  for (const message of session.messages) {
    for (const part of message.content ?? []) {
      if (part.state?.status === 'running' && !active.has(session.id)) {
        part.state = { status: 'error', error: { type: 'aborted' } };
      }
    }
  }
  session.inbox = session.inbox.filter((queued) => queued.id !== item.id);
  session.messages.push({ id: item.id, type: 'user', text: item.text, metadata: item.metadata });
  save();
  void runTurn(session, item);
}

const routes = [
  ['GET', /^\/api\/info$/, () => ({ data: { version: 'fake' } })],
  ['GET', /^\/api\/credential$/, () => ({ data: [] })],
  ['POST', /^\/api\/credential$/, () => ({ data: {} })],
  [
    'GET',
    /^\/api\/agent$/,
    () => ({
      data: [{ id: 'build', permissions: [{ action: '*', resource: '*', effect: 'allow' }] }],
    }),
  ],
  ['GET', /^\/api\/plugin$/, () => ({ data: [{ id: 'shift', state: { status: 'active' } }] })],
  [
    'GET',
    /^\/api\/session\/active$/,
    () => ({
      data: Object.fromEntries([...active.keys()].map((key) => [key, { type: 'running' }])),
    }),
  ],
  [
    'POST',
    /^\/api\/session$/,
    (_match, body) => {
      state.sessions[body.id] ??= { ...body, messages: [], inbox: [] };
      save();
      return { data: publicSession(state.sessions[body.id]) };
    },
  ],
  [
    'GET',
    /^\/api\/session\/([^/]+)$/,
    ([, sid]) => state.sessions[sid] && { data: publicSession(state.sessions[sid]) },
  ],
  [
    'PATCH',
    /^\/api\/session\/([^/]+)$/,
    ([, sid], body) => {
      const session = state.sessions[sid];
      if (!session) return undefined;
      session.permissions = body.permissions;
      save();
      return { data: publicSession(session) };
    },
  ],
  [
    'POST',
    /^\/api\/session\/([^/]+)\/prompt$/,
    ([, sid], body) => {
      const session = state.sessions[sid];
      if (!session) return undefined;
      const existing =
        session.messages.find((message) => message.id === body.id) ??
        session.inbox.find((queued) => queued.id === body.id);
      if (existing) {
        if (session.inbox.includes(existing) && !active.has(sid)) deliver(session, existing);
        return { data: { id: body.id, type: 'user', payload: { text: existing.text } } };
      }
      const item = { id: body.id, text: body.text, metadata: body.metadata };
      session.inbox.push(item);
      if (!active.has(sid)) deliver(session, item);
      else save();
      return { data: { id: body.id, type: 'user', payload: { text: body.text } } };
    },
  ],
  [
    'GET',
    /^\/api\/session\/([^/]+)\/message\/([^/]+)$/,
    ([, sid, mid]) => {
      const message = state.sessions[sid]?.messages.find((candidate) => candidate.id === mid);
      return message && { data: message };
    },
  ],
  [
    'GET',
    /^\/api\/session\/([^/]+)\/message$/,
    ([, sid], _body, query) =>
      state.sessions[sid] && {
        data: query.has('cursor') ? [] : state.sessions[sid].messages,
        cursor: { next: 'end' },
      },
  ],
  [
    'GET',
    /^\/api\/session\/([^/]+)\/inbox$/,
    ([, sid]) => state.sessions[sid] && { data: state.sessions[sid].inbox },
  ],
  [
    'DELETE',
    /^\/api\/session\/([^/]+)\/inbox\/([^/]+)$/,
    ([, sid, item]) => {
      const session = state.sessions[sid];
      if (session) session.inbox = session.inbox.filter((queued) => queued.id !== item);
      save();
      return { data: null };
    },
  ],
  ['GET', /^\/api\/session\/([^/]+)\/(permission|form)$/, () => ({ data: [] })],
  [
    'POST',
    /^\/api\/session\/([^/]+)\/interrupt$/,
    ([, sid]) => {
      const control = active.get(sid);
      if (!control) return { interrupted: false };
      control.abort();
      control.tool?.kill('SIGKILL');
      if (!control.tool) {
        active.delete(sid);
        state.sessions[sid].messages.push({ id: id('msg'), type: 'idle', outcome: 'interrupted' });
        save();
      }
      return { interrupted: true };
    },
  ],
];

const server = createServer((request, response) => {
  if (request.headers.authorization !== expected) return response.writeHead(401).end();
  let text = '';
  request.on('data', (chunk) => (text += chunk));
  request.on('end', () => {
    const url = new URL(request.url, 'http://localhost');
    const route = routes.find(
      ([method, pattern]) => method === request.method && pattern.test(url.pathname),
    );
    const result = route?.[2](
      route[1].exec(url.pathname),
      text ? JSON.parse(text) : {},
      url.searchParams,
    );
    if (result === undefined) return response.writeHead(404).end('{}');
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
  });
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`server listening on http://127.0.0.1:${server.address().port}\n`);
  process.stdout.write(`server password ${password}\n`);
});
process.on('SIGTERM', () => process.exit(130));
