// Queuert 0.16.0 SQLite adoption probe for Shift's job gate (docs/implementation-decisions.md).
// Development evidence only. Install the candidate into its own directory, then pass it:
//   mkdir /tmp/qprobe && cd /tmp/qprobe && npm init -y &&
//   npm install --ignore-scripts queuert@0.16.0 @queuert/sqlite@0.16.0 better-sqlite3@13.0.3
//   node apps/server/tools/queue-probe/queuert-probe.mjs /tmp/qprobe
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const pkg = process.argv[2];
const { createAsyncRwLock, createSqliteStateAdapter } = await import(
  `${pkg}/node_modules/@queuert/sqlite/dist/index.mjs`
);
const q = await import(`${pkg}/node_modules/queuert/dist/index.mjs`);
const Database = (await import(`${pkg}/node_modules/better-sqlite3/lib/index.js`)).default;
const role = process.argv[3] ?? 'parent';
const file = process.argv[4] ?? join(mkdtempSync(join(tmpdir(), 'qprobe-')), 'db.sqlite');

const jobTypes = q.defineJobTypes(); // one entry job type, `work`; types only
async function open(attemptTimeoutMs = 1000) {
  const db = new Database(file);
  db.pragma('journal_mode=WAL');
  db.exec(
    'CREATE TABLE IF NOT EXISTS domain (id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS effects (n INTEGER, pid INTEGER, at INTEGER)',
  );
  const lock = createAsyncRwLock();
  const stmts = new Map();
  const stateProvider = {
    transactionConcurrency: 'serialized',
    withTransaction: async (fn) => {
      using _h = await lock.acquireWrite();
      db.exec('BEGIN');
      try {
        const r = await fn({ db });
        db.exec('COMMIT');
        return r;
      } catch (e) {
        if (db.inTransaction) db.exec('ROLLBACK');
        throw e;
      }
    },
    executeSql: async ({ txCtx, id, sql, params, columnTypes, readOnly }) => {
      const run = () => {
        const s =
          id !== undefined
            ? (stmts.get(id) ?? stmts.set(id, db.prepare(sql)).get(id))
            : db.prepare(sql);
        if (Object.keys(columnTypes).length > 0) return s.all(...(params ?? []));
        if (params?.length) s.run(...params);
        else db.exec(sql);
        return [];
      };
      if (txCtx) return run();
      using _h = readOnly ? await lock.acquireRead() : await lock.acquireWrite();
      return run();
    },
  };
  const stateAdapter = await createSqliteStateAdapter({ stateProvider });
  await stateAdapter.migrateToLatest();
  const client = await q.createClient({ stateAdapter, jobTypes });
  return { db, lock, client, stateAdapter, attemptTimeoutMs };
}
const tables = (db) =>
  db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('domain','effects') ORDER BY name",
    )
    .all()
    .map((r) => r.name);
const jobCount = (db) => {
  const t = tables(db).find((n) => /job/.test(n) && !/blocker|migration/.test(n));
  return t ? db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c : -1;
};

// Shift's commit shape, following Queuert's documented better-sqlite3 pattern.
async function commit(env, id, { fail = false, during } = {}) {
  return q.withTransactionHooks(async (transactionHooks) => {
    using _h = await env.lock.acquireWrite();
    env.db.exec('BEGIN');
    try {
      env.db.prepare('INSERT INTO domain (id) VALUES (?)').run(id);
      if (during) setTimeout(during, 0);
      await env.client.createChain({
        db: env.db,
        transactionHooks,
        typeName: 'work',
        input: { id },
      });
      if (during) await new Promise((r) => setTimeout(r, 20));
      if (fail) throw new Error('domain validation failed');
      env.db.exec('COMMIT');
    } catch (e) {
      if (env.db.inTransaction) env.db.exec('ROLLBACK');
      throw e;
    }
  });
}

if (role === 'parent') {
  const env = await open();
  const out = { file, tables: tables(env.db) };
  await commit(env, 'committed');
  await commit(env, 'rolled-back', { fail: true }).catch(() => {});
  out.check1 = {
    committedDomain: env.db.prepare("SELECT COUNT(*) c FROM domain WHERE id='committed'").get().c,
    rolledBackDomain: env.db.prepare("SELECT COUNT(*) c FROM domain WHERE id='rolled-back'").get()
      .c,
    jobs: jobCount(env.db),
  };
  // An ordinary synchronous Shift transaction that runs while the async one is open.
  let interleaved;
  await commit(env, 'outer', {
    fail: true,
    during: () => {
      try {
        env.db.transaction(() =>
          env.db.prepare('INSERT INTO domain (id) VALUES (?)').run('unrelated'),
        )();
        interleaved = 'ran';
      } catch (e) {
        interleaved = `threw: ${e.message}`;
      }
    },
  }).catch(() => {});
  out.interleaving = {
    syncShiftWrite: interleaved,
    unrelatedRowSurvived: env.db.prepare("SELECT COUNT(*) c FROM domain WHERE id='unrelated'").get()
      .c,
  };
  // Checks 2/3: a worker crashes during a staged attempt with an external effect in flight.
  await commit(env, 'effect');
  env.db.close();
  const child = spawn(process.execPath, [process.argv[1], pkg, 'worker', file], {
    stdio: 'inherit',
  });
  await new Promise((r) => setTimeout(r, 1500));
  child.kill('SIGKILL');
  await new Promise((r) => child.once('exit', r));
  const worker2 = spawn(process.execPath, [process.argv[1], pkg, 'worker', file], {
    stdio: 'inherit',
  });
  await new Promise((r) => setTimeout(r, 20000));
  worker2.kill('SIGKILL');
  await new Promise((r) => worker2.once('exit', r));
  const db = new Database(file);
  out.crash = { effectAttempts: db.prepare('SELECT n, pid FROM effects ORDER BY at').all() };
  console.log(JSON.stringify(out, null, 2));
  db.close();
  rmSync(join(file, '..'), { recursive: true, force: true });
} else {
  const env = await open();
  const worker = await q.createInProcessWorker({
    client: env.client,
    processors: q.createProcessors({
      client: env.client,
      jobTypes,
      attemptConfig: { timeoutMs: 1000, heartbeatMs: 500 },
      processors: {
        work: {
          attemptHandler: async ({ job, prepare, complete }) => {
            const n = await prepare({ mode: 'staged' }, ({ db }) => {
              db.prepare('INSERT INTO effects (n, pid, at) VALUES (?, ?, ?)').run(
                job.attempt ?? 0,
                process.pid,
                Date.now(),
              );
              return job.attempt ?? 0;
            });
            if (job.input.id === 'effect') await new Promise(() => {}); // external effect never finishes
            return complete(async ({ finish }) => finish({ output: { n } }));
          },
        },
      },
    }),
  });
  await worker.start();
}
