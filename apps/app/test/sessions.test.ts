import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown, mergeTranscript, readTranscript } from '../src/client-ui/Sessions.js';
import { ServerHttp, TransportFailure } from '../src/client-core/http.js';
import { diagnose, renameNode, type Draft } from '../src/client-ui/draft.js';

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

test('reports render as elements: headings, lists, code and emphasis', () => {
  assert.equal(
    render('# Done\nMoved `a.ts` and **kept** b.\n\n- one\n- two\n\n1. first\n\n```\nx < y\n```'),
    '<div class="markdown"><h4 class="md-h1">Done</h4><p>Moved <code>a.ts</code> and <strong>kept</strong> b.</p><ul><li>one</li><li>two</li></ul><ol><li>first</li></ol><pre class="code">x &lt; y</pre></div>',
  );
});

test('markup, scripts and links in a report never become live', () => {
  const html = render(
    '<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[click](javascript:alert(1)) and [docs](https://example.com)',
  );
  assert.doesNotMatch(html, /<script|<img|<a\b|href=/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  // A link's address is shown as text beside its label, never as a link.
  assert.match(html, /<span class="md-link">click <span class="note">\(javascript:alert\(1/);
  assert.match(html, /<span class="md-link">docs <span class="note">\(https:\/\/example\.com\)/);
});

const agents = (review: Record<string, unknown>): Draft => ({
  nodes: [
    { id: 'start', type: 'manual_trigger' },
    { id: 'write', type: 'agent', config: { goal: 'Write.' } },
    { id: 'review', type: 'agent', config: { goal: 'Review.', ...review } },
    { id: 'shape', type: 'transform', config: { data: {} } },
  ],
  connections: [
    { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'write', toPort: 'input' },
    { id: 'c2', fromNodeId: 'write', fromPort: 'success', toNodeId: 'review', toPort: 'input' },
  ],
});
const messages = (draft: Draft) =>
  diagnose(draft)
    .filter((problem) => problem.severity === 'error')
    .map((problem) => problem.message);

test('renaming an agent follows it into the handoffs other agents read', () => {
  const result = renameNode(agents({ handoffs: { nodes: ['write'] } }), 'write', 'author');
  assert.ok('draft' in result);
  const review = (
    result.draft['nodes'] as Array<{ id: string; config: Record<string, unknown> }>
  ).find((node) => node.id === 'review')!;
  assert.deepEqual(review.config['handoffs'], { nodes: ['author'] });
});

test('session and handoff settings are diagnosed as the server does', () => {
  assert.deepEqual(messages(agents({ session: { strategy: 'per_run' } })), []);
  assert.deepEqual(messages(agents({ session: { strategy: 'per_run', lifetime: 'ephemeral' } })), [
    'review: only a new session for each run of the step can be archived.',
  ]);
  assert.deepEqual(messages(agents({ session: { strategy: 'reference' } })), [
    'review continues an existing session but names none.',
  ]);
  assert.deepEqual(messages(agents({ handoffs: { nodes: ['shape', 'review', 'gone'] } })), [
    'review reads the handoff of shape, which is not another agent.',
    'review reads the handoff of review, which is not another agent.',
    'review reads the handoff of gone, which is not another agent.',
  ]);
  // The new settings are known, so none shows as an unknown setting.
  assert.deepEqual(
    messages(
      agents({
        session: { strategy: 'fresh', lifetime: 'ephemeral' },
        reports: { handoff: 'off' },
        handoffs: { incoming: false },
      }),
    ),
    [],
  );
});

const entry = (position: number, text = `entry ${position}`) => ({
  id: `00000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
  invocationId: null,
  sourceKey: `msg_${position}`,
  revision: 1,
  position,
  kind: 'assistant' as const,
  text,
  createdAt: 0,
  updatedAt: 0,
});

test('a long transcript is read to its end, page by page', async () => {
  const all = Array.from({ length: 1200 }, (_, index) => entry(index + 1));
  const asked: number[] = [];
  const page = async (after: number) => {
    asked.push(after);
    const entries = all.filter((item) => item.position > after).slice(0, 500);
    return {
      schemaVersion: 1 as const,
      requestId: '00000000-0000-4000-8000-000000000000',
      entries,
      next: all.some((item) => item.position > (entries.at(-1)?.position ?? after))
        ? entries.at(-1)!.position
        : null,
    };
  };
  const read = await readTranscript(page, 0);
  assert.equal(read?.length, 1200);
  assert.deepEqual(asked, [0, 500, 1000]);
  // A refresh from near the end reads only the tail.
  assert.equal((await readTranscript(page, 1000))?.length, 200);
  assert.equal(await readTranscript(async () => null, 0), null);
});

test('the island keeps the latest entries and takes revisions in place', () => {
  const first = mergeTranscript(
    { entries: [], dropped: 0 },
    [1, 2, 3, 4, 5].map((n) => entry(n)),
    4,
  );
  assert.deepEqual(
    first.entries.map((item) => item.position),
    [2, 3, 4, 5],
  );
  assert.equal(first.dropped, 1);
  const revised = mergeTranscript(
    first,
    [{ ...entry(5, 'longer reply'), revision: 2 }, entry(6)],
    4,
  );
  assert.deepEqual(
    revised.entries.map((item) => [item.position, item.text]),
    [
      [3, 'entry 3'],
      [4, 'entry 4'],
      [5, 'longer reply'],
      [6, 'entry 6'],
    ],
  );
  assert.equal(revised.dropped, 2);
});

test('a report larger than its limit is cut off while it streams', async () => {
  let pulled = 0;
  let cancelled = false;
  const endless = () =>
    new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(64 * 1024).fill(97));
      },
      cancel() {
        cancelled = true;
      },
    });
  const http = new ServerHttp(async () => ({
    status: 200,
    text: async () => {
      throw new Error('the whole body must never be read');
    },
    body: endless(),
  }));
  await assert.rejects(
    http.requestText('https://shift.test', '/report', { bearer: 't', maxBytes: 1024 * 1024 }),
    (error: unknown) => error instanceof TransportFailure && error.kind === 'invalid',
  );
  assert.ok(cancelled, 'the stream was cancelled');
  assert.ok(pulled <= 20, `stopped near the limit, after ${pulled} chunks`);
  const small = new ServerHttp(async () => ({
    status: 200,
    text: async () => '',
    body: new Blob(['# Done\nAll good.']).stream(),
  }));
  assert.deepEqual(
    await small.requestText('https://shift.test', '/report', { bearer: 't', maxBytes: 1024 }),
    { status: 200, text: '# Done\nAll good.' },
  );
  const broken = new ServerHttp(async () => ({
    status: 200,
    text: async () => '',
    body: new Blob([new Uint8Array([0xff, 0xfe])]).stream(),
  }));
  await assert.rejects(
    broken.requestText('https://shift.test', '/report', { bearer: 't', maxBytes: 1024 }),
    TransportFailure,
  );
});
