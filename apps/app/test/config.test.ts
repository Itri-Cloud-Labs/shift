import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addField,
  convertValue,
  emptyToUndefined,
  parsePath,
  parseValue,
  pathEditable,
  plainForm,
  readDataValue,
  readFields,
  readRule,
  formProblem,
  unknownConfig,
  kindOf,
  removeField,
  renameField,
  ruleBindings,
  setRequired,
  valueKind,
  withKind,
  withOperator,
} from '../src/client-ui/config.js';
import {
  addNode,
  connect,
  diagnose,
  duplicateNode,
  keepMine,
  recover,
  renameBinding,
  renameCase,
  setBinding,
  setConfig,
  setNodeField,
  takeTheirs,
  type Draft,
} from '../src/client-ui/draft.js';
import { nodeWidth, readDocument } from '../src/client-ui/graph.js';

const comparison = { op: 'gt', left: { binding: 'files' }, right: { value: 20 } };

test('a rule reads as a test, a group or something kept', () => {
  assert.deepEqual(readRule(comparison), { kind: 'test', comparison });
  assert.deepEqual(readRule({ any: [comparison, { all: [comparison] }] }), {
    kind: 'group',
    group: 'any',
    items: [comparison, { all: [comparison] }],
  });
  assert.equal(readRule({ all: [] }).kind, 'kept');
  assert.equal(readRule({ all: [comparison], extra: 1 }).kind, 'kept');
  assert.equal(readRule('nonsense').kind, 'kept');
});

test('form problems match the server, pointer and message', () => {
  const form = (properties: unknown) => ({ type: 'object', properties });
  assert.equal(formProblem(form({ a: { type: 'string' } })), null);
  assert.deepEqual(formProblem({ type: 'array' }), {
    at: '',
    message: 'A form is an object schema.',
  });
  assert.deepEqual(formProblem(form({ a: { type: 'string', oneOf: [] } })), {
    at: '/properties/a/oneOf',
    message: 'Forms do not support oneOf on string.',
  });
  assert.deepEqual(formProblem(form({ a: { type: 'string', format: 'uuid' } })), {
    at: '/properties/a/format',
    message: 'Use date, date-time, email or uri.',
  });
  const nest = (depth: number): unknown =>
    depth === 0 ? { type: 'string' } : { type: 'object', properties: { a: nest(depth - 1) } };
  assert.equal(formProblem(nest(4)), null);
  assert.deepEqual(formProblem(nest(5)), {
    at: '/properties/a/properties/a/properties/a/properties/a',
    message: 'Forms nest at most 4 levels.',
  });
  assert.deepEqual(formProblem(form({ a: { type: 'array' } })), {
    at: '/properties/a',
    message: 'An array field needs items.',
  });
});

test('settings a node type does not have are found', () => {
  assert.deepEqual(unknownConfig('agent', { goal: 'g', later: 1 }), { later: 1 });
  assert.deepEqual(unknownConfig('future_type', { a: 1 }), {});
});

test('the operator decides the operands', () => {
  assert.equal(withOperator(comparison, 'exists').right, undefined);
  assert.deepEqual(withOperator({ op: 'exists', left: { binding: 'a' } }, 'eq').right, {
    value: '',
  });
  assert.deepEqual(withOperator({ ...comparison, right: { value: 'a, b' } }, 'in').right, {
    value: ['a', 'b'],
  });
  // Numbers stay numbers; a binding on the right is left alone.
  assert.deepEqual(withOperator(comparison, 'lt').right, { value: 20 });
  assert.deepEqual(withOperator({ ...comparison, right: { binding: 'b' } }, 'in').right, {
    binding: 'b',
  });
});

test('values keep their type, and what has no plain form is marked', () => {
  assert.equal(parseValue('number', '7'), 7);
  assert.equal(parseValue('number', ''), undefined);
  assert.equal(parseValue('number', 'x'), undefined);
  assert.equal(parseValue('boolean', 'false'), false);
  assert.deepEqual(parseValue('list', 'a, b,,'), ['a', 'b']);
  assert.equal(convertValue('12', 'number'), 12);
  assert.equal(convertValue('twelve', 'number'), 0);
  assert.equal(valueKind({ a: 1 }), 'kept');
  assert.equal(valueKind([1, 2]), 'kept');
  assert.equal(valueKind(null), 'null');
  assert.equal(convertValue('x', 'null'), null);
});

test('a path with a dot in a key is not offered as text', () => {
  assert.deepEqual(parsePath('data. files.'), ['data', 'files']);
  assert.equal(pathEditable(['data', 'files']), true);
  assert.equal(pathEditable(['a.b']), false);
});

test('schema edits keep the keywords they do not touch', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      area: { type: 'string', title: 'Area', maxLength: 10 },
      nested: { type: 'object', properties: {} },
    },
    required: ['area'],
  };
  const renamed = renameField(schema, 'area', 'zone');
  assert.deepEqual(renamed['required'], ['zone']);
  assert.equal(renamed['additionalProperties'], false);
  assert.deepEqual((renamed['properties'] as Record<string, unknown>)['zone'], {
    type: 'string',
    title: 'Area',
    maxLength: 10,
  });
  assert.deepEqual(Object.keys(renamed['properties'] as object), ['zone', 'nested']);
  assert.equal(removeField(schema, 'area')['required'], undefined);
  assert.deepEqual(setRequired(schema, 'nested', true)['required'], ['area', 'nested']);
  assert.equal(readFields(schema)?.[1]?.kind, 'object');
  assert.equal(kindOf({ type: 'array' }), null);
  assert.equal(kindOf({ oneOf: [] }), null);
  assert.deepEqual(withKind({ type: 'string', title: 'T' }, 'array'), {
    title: 'T',
    type: 'array',
    items: { type: 'string' },
  });
  assert.equal(readFields(true), null);
  assert.equal(readFields({ oneOf: [] }), null);
  assert.deepEqual(readFields(undefined), []);
  assert.deepEqual(withKind({ type: 'string', title: 'T', maxLength: 3 }, 'integer'), {
    title: 'T',
    type: 'integer',
  });
  assert.deepEqual(withKind({ type: 'string' }, 'choice'), { type: 'string', enum: [] });
  assert.equal(emptyToUndefined({ type: 'object', properties: {} }), undefined);
  const constrained = { type: 'object', properties: {}, minProperties: 1 };
  assert.equal(emptyToUndefined(constrained), constrained);
  assert.equal(Object.keys(addField(addField(undefined))['properties'] as object).length, 2);
});

test('only flat schemas of known fields get widgets for run input', () => {
  assert.equal(
    plainForm({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }),
    true,
  );
  assert.equal(plainForm({ type: 'object', properties: { a: { type: 'object' } } }), true);
  assert.equal(plainForm({ type: 'object', properties: { a: { type: 'array' } } }), false);
  assert.equal(plainForm({ type: 'object', oneOf: [] }), false);
  assert.equal(plainForm(true), false);
});

test('a transform field reads as a binding, a value or nested', () => {
  assert.deepEqual(readDataValue({ $binding: 'a' }), { kind: 'binding', name: 'a' });
  assert.deepEqual(readDataValue(3), { kind: 'value', value: 3 });
  assert.deepEqual(readDataValue({ a: 1 }), { kind: 'object' });
  assert.deepEqual(readDataValue({ $binding: 1 }), { kind: 'kept' });
  assert.deepEqual(readDataValue([{ a: 1 }]), { kind: 'kept' });
});

const draft: Draft = {
  nodes: [
    { id: 'start', type: 'manual_trigger', config: {}, position: { x: 0, y: 0 } },
    {
      id: 'pick',
      type: 'switch',
      config: {
        cases: [
          {
            port: 'large',
            when: { all: [{ op: 'gt', left: { binding: 'files' }, right: { value: 1 } }] },
            extra: 'kept',
          },
        ],
        goal: 'ignored',
      },
      bindings: { files: { kind: 'input', path: ['data'] }, other: { kind: 'trigger', path: [] } },
      position: { x: 400, y: 0 },
    },
    {
      id: 'work',
      type: 'agent',
      config: { goal: 'Read {{files}} and {{ other }}, not {{filesize}}', data: 1 },
      bindings: { files: { kind: 'input', path: [] }, other: { kind: 'input', path: [] } },
      position: { x: 800, y: 0 },
    },
    {
      id: 'make',
      type: 'transform',
      config: { data: { a: { $binding: 'files' }, b: { nested: { $binding: 'files' } } } },
      bindings: { files: { kind: 'input', path: [] } },
      position: { x: 1200, y: 0 },
    },
  ],
  connections: [
    { id: 'c1', fromNodeId: 'pick', fromPort: 'large', toNodeId: 'work', toPort: 'input' },
  ],
};
const must = (result: { draft: Draft } | { problem: string }): Draft => {
  assert.ok('draft' in result, 'problem' in result ? result.problem : '');
  return result.draft;
};
const node = (from: Draft, id: string) => readDocument(from).nodes.find((item) => item.id === id)!;

test('renaming a value follows it through the rules and templates of its node only', () => {
  const pick = must(renameBinding(draft, 'pick', 'files', 'count'));
  assert.deepEqual(Object.keys(node(pick, 'pick').bindings), ['count', 'other']);
  assert.deepEqual(ruleBindings((node(pick, 'pick').config['cases'] as any)[0].when), ['count']);
  assert.equal((node(pick, 'pick').config['cases'] as any)[0].extra, 'kept');
  assert.deepEqual(Object.keys(node(pick, 'work').bindings), ['files', 'other']);
  const work = must(renameBinding(draft, 'work', 'files', 'count'));
  assert.equal(
    node(work, 'work').config['goal'],
    'Read {{count}} and {{ other }}, not {{filesize}}',
  );
  const make = must(renameBinding(draft, 'make', 'files', 'count'));
  assert.deepEqual(node(make, 'make').config['data'], {
    a: { $binding: 'count' },
    b: { nested: { $binding: 'count' } },
  });
  assert.ok('problem' in renameBinding(draft, 'pick', 'files', 'other'));
  assert.ok('problem' in renameBinding(draft, 'pick', 'files', '1bad'));
});

test('a literal in a rule that looks like a binding is not renamed', () => {
  const literal = setConfig(draft, 'pick', 'cases', [
    {
      port: 'a',
      when: { op: 'eq', left: { binding: 'files' }, right: { value: { binding: 'files' } } },
    },
  ]);
  const renamed = must(renameBinding(literal, 'pick', 'files', 'count'));
  const when = (node(renamed, 'pick').config['cases'] as any)[0].when;
  assert.deepEqual(when.left, { binding: 'count' });
  assert.deepEqual(when.right, { value: { binding: 'files' } });
});

test('renaming a case keeps its connection, and bad names are refused', () => {
  const renamed = must(renameCase(draft, 'pick', 0, 'huge'));
  assert.deepEqual(
    readDocument(renamed).connections.map((item) => item.fromPort),
    ['huge'],
  );
  for (const bad of ['Upper', 'default', 'error', ''])
    assert.ok('problem' in renameCase(draft, 'pick', 0, bad));
  const two = setConfig(draft, 'pick', 'cases', [
    ...(node(draft, 'pick').config['cases'] as unknown[]),
    { port: 'small', when: comparison },
  ]);
  assert.ok('problem' in renameCase(two, 'pick', 1, 'large'));
});

test('bindings are set and removed in place, keeping their other fields', () => {
  const source = {
    kind: 'node',
    nodeId: 'start',
    execution: { sequence: 2 },
    path: [],
    optional: true,
    fallback: null,
  };
  const set = setBinding(draft, 'pick', 'files', source);
  assert.deepEqual(Object.keys(node(set, 'pick').bindings), ['files', 'other']);
  assert.deepEqual(node(set, 'pick').bindings['files'], source);
  assert.deepEqual(Object.keys(node(setBinding(draft, 'pick', 'files'), 'pick').bindings), [
    'other',
  ]);
});

test('rules that read undeclared values and bad case ports are diagnosed', () => {
  const problems = (from: Draft) =>
    diagnose(from)
      .map((item) => item.message)
      .join('\n');
  assert.doesNotMatch(problems(draft), /rule of/);
  assert.match(problems(setBinding(draft, 'pick', 'files')), /rule of pick reads files/);
  assert.match(
    problems(setConfig(draft, 'pick', 'cases', [{ port: 'Bad', when: comparison }])),
    /case Bad/,
  );
});

test('a new node lands where it covers no other', () => {
  const cards = {
    nodes: [
      { id: 'a', type: 'end', config: {}, position: { x: 100, y: 100 } },
      { id: 'b', type: 'end', config: {}, position: { x: 100, y: 208 } },
    ],
    connections: [],
  };
  const added = addNode(cards, 'end', { x: 120, y: 110 });
  const spot = node(added.draft, added.nodeId).position!;
  assert.deepEqual(spot, { x: 120, y: 316 });
  const clear = addNode(cards, 'end', { x: 100 + nodeWidth + 100, y: 100 });
  assert.deepEqual(node(clear.draft, clear.nodeId).position, { x: 100 + nodeWidth + 100, y: 100 });
  const copy = duplicateNode(cards, 'a');
  assert.notDeepEqual(node(copy.draft, copy.nodeId).position, { x: 140, y: 140 });
  assert.ok(must(connect(added.draft, 'a', 'x', added.nodeId)));
});

test('recovered edits come back as edits, or meet a newer save as a conflict', () => {
  const server = { nodes: [{ id: 'start', type: 'manual_trigger' }] };
  const mine = { nodes: [...server.nodes, { id: 'end', type: 'end' }] };
  const same = recover(3, server, { revision: 3, draft: mine });
  assert.equal(same.revision, 3);
  assert.equal(same.history.present, mine);
  assert.equal(same.base, server);
  assert.equal(same.theirs, null);
  const newer = recover(5, server, { revision: 3, draft: mine });
  assert.equal(newer.revision, 3);
  assert.equal(newer.history.present, mine);
  assert.deepEqual(newer.theirs, { revision: 5, draft: server });
  // Keeping mine then aims the save at their revision.
  assert.equal(keepMine(newer).revision, 5);
  assert.equal(takeTheirs(newer).history.present, server);
  // Nothing changed: an ordinary draft, no edits.
  const clean = recover(5, server, { revision: 3, draft: structuredClone(server) });
  assert.equal(clean.history.present, server);
  assert.equal(clean.revision, 5);
});

test('diagnostics follow the server on forms, retries, unknown settings and size', () => {
  const messages = (from: Draft) =>
    diagnose(from)
      .map((item) => item.message)
      .join('\n');
  const one = (node: Record<string, unknown>) => ({
    nodes: [
      { id: 'start', type: 'manual_trigger' },
      { id: 'n', ...node },
    ],
    connections: [
      { id: 'c1', fromNodeId: 'start', fromPort: 'success', toNodeId: 'n', toPort: 'input' },
    ],
  });
  const dated = { type: 'object', properties: { a: { type: 'date' } } };
  assert.match(
    messages(one({ type: 'human_input', config: { title: 't', form: dated } })),
    /n, form at \/properties\/a\/type: Use string/,
  );
  assert.match(
    messages(
      one({ type: 'end', retry: { maxAttempts: 2, initialDelayMs: 5000, maxDelayMs: 1000 } }),
    ),
    /longest wait is shorter/,
  );
  assert.match(messages(one({ type: 'end', config: { later: 1 } })), /setting later/);
  assert.match(
    messages(one({ type: 'end', config: { reason: 'x'.repeat(1024 * 1024) } })),
    /larger than 1 MiB/,
  );
  let deep: unknown = comparison;
  for (let level = 0; level < 5; level++) deep = { all: [deep] };
  assert.match(messages(one({ type: 'condition', config: { when: deep } })), /4 groups deep/);
});

test('a node field is set without touching the rest', () => {
  const retry = { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2 };
  const edited = setNodeField(draft, 'pick', 'retry', retry);
  const pick = (edited['nodes'] as Record<string, unknown>[])[1]!;
  assert.deepEqual(pick['retry'], retry);
  assert.deepEqual(pick['config'], (draft['nodes'] as Record<string, unknown>[])[1]!['config']);
});
