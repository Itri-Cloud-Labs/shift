#!/usr/bin/env node
// Stands in for `opencode serve` in supervisor tests. It prints the same startup lines, answers the
// few routes the supervisor uses, and starts a detached "tool" process in its own session, as
// OpenCode does for shell commands. Its environment is replaced by the supervisor, so it reports
// through files in its working directory (the namespace root).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const password = randomBytes(12).toString('hex');
const expected = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
const tool = spawn('sleep', ['300'], {
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, OPENCODE_SESSION_ID: 'ses_fake' },
});
tool.unref();
const credentials = [];

const server = createServer((request, response) => {
  if (request.headers.authorization !== expected) {
    response.writeHead(401).end();
    return;
  }
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    const path = new URL(request.url, 'http://localhost').pathname;
    let result = { data: null };
    if (path === '/api/credential' && request.method === 'POST') {
      const { integrationID, label } = JSON.parse(body);
      credentials.push({ integrationID, label });
      appendFileSync('fake-credentials.log', `${integrationID}\n`);
    } else if (path === '/api/credential') {
      result = { data: credentials };
    } else if (path !== '/api/info') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
  });
});

server.listen(0, '127.0.0.1', () => {
  writeFileSync(
    'fake-report.json',
    JSON.stringify({
      pid: process.pid,
      toolPid: tool.pid,
      args: process.argv.slice(2),
      env: process.env,
    }),
  );
  process.stdout.write(`server listening on http://127.0.0.1:${server.address().port}\n`);
  process.stdout.write(`server password ${password}\n`);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
