import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../src/client-ui/Sessions.js';
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
