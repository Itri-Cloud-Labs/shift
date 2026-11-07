import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DraftRecovery, MemoryRecoveryStore, keptLimit } from '../src/client-core/recovery.js';

const profile = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const workflow = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

test('kept edits are per profile, newest first, and replaced per workflow', async () => {
  let clock = 0;
  const recovery = new DraftRecovery(new MemoryRecoveryStore(), () => ++clock);
  await recovery.keep(profile, workflow(1), 2, { a: 1 });
  await recovery.keep(profile, workflow(2), 0, { b: 1 });
  await recovery.keep(profile, workflow(1), 3, { a: 2 });
  assert.deepEqual(
    (await recovery.list(profile)).map((item) => [item.workflowId, item.revision, item.draft]),
    [
      [workflow(1), 3, { a: 2 }],
      [workflow(2), 0, { b: 1 }],
    ],
  );
  assert.deepEqual(await recovery.list(other), []);
  await recovery.forget(profile, workflow(1));
  assert.deepEqual(
    (await recovery.list(profile)).map((item) => item.workflowId),
    [workflow(2)],
  );
  await recovery.clear(profile);
  assert.deepEqual(await recovery.list(profile), []);
});

test('kept edits are bounded by count and size, dropping the oldest', async () => {
  let clock = 0;
  const recovery = new DraftRecovery(new MemoryRecoveryStore(), () => ++clock);
  for (let index = 1; index <= keptLimit + 3; index++)
    await recovery.keep(profile, workflow(index), 0, { index });
  const kept = await recovery.list(profile);
  assert.equal(kept.length, keptLimit);
  assert.equal(kept[0]!.workflowId, workflow(keptLimit + 3));
  assert.ok(!kept.some((item) => item.workflowId === workflow(1)));
  const large = { text: 'x'.repeat(3 * 1024 * 1024) };
  for (let index = 1; index <= 3; index++)
    await recovery.keep(profile, workflow(100 + index), 0, large);
  const ids = (await recovery.list(profile)).map((item) => item.workflowId);
  assert.deepEqual(ids.slice(0, 2), [workflow(103), workflow(102)]);
  assert.ok(!ids.includes(workflow(101)));
});

test('writes land in order even when they are not awaited', async () => {
  const recovery = new DraftRecovery(new MemoryRecoveryStore());
  void recovery.keep(profile, workflow(1), 0, { step: 1 });
  void recovery.keep(profile, workflow(1), 0, { step: 2 });
  void recovery.forget(profile, workflow(1));
  void recovery.keep(profile, workflow(1), 0, { step: 3 });
  assert.deepEqual(
    (await recovery.list(profile)).map((item) => item.draft),
    [{ step: 3 }],
  );
});
