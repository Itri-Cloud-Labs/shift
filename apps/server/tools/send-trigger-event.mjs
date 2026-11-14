#!/usr/bin/env node
// Sends one event to a Shift webhook trigger, the way a sender should: the secret comes from the
// SHIFT_TRIGGER_SECRET environment variable, never the command line, and a signed request covers
// the exact bytes sent. Usage:
//   SHIFT_TRIGGER_SECRET=... node tools/send-trigger-event.mjs URL [--file EVENT.json]
//     [--signature | --bearer] [--event-id ID]
// URL is http(s)://HOST:PORT/api/v0/triggers/TRIGGER_ID/events. Without --file the event is
// read from standard input.
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: 'string' },
    signature: { type: 'boolean' },
    bearer: { type: 'boolean' },
    'event-id': { type: 'string' },
  },
});
const [url] = positionals;
const secret = process.env['SHIFT_TRIGGER_SECRET'];
if (!url || !secret) {
  console.error('Give the trigger URL and set SHIFT_TRIGGER_SECRET.');
  process.exit(2);
}
let body;
if (values.file) body = await readFile(values.file);
else {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  body = Buffer.concat(chunks);
}
const headers = { 'content-type': 'application/json' };
if (values['event-id']) headers['x-shift-event-id'] = values['event-id'];
if (values.signature) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  headers['x-shift-timestamp'] = timestamp;
  headers['x-shift-signature'] =
    `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex')}`;
} else headers['authorization'] = `Bearer ${secret}`;
const response = await fetch(url, { method: 'POST', headers, body });
const text = await response.text();
console.log(response.status, text);
process.exit(response.ok ? 0 : 1);
