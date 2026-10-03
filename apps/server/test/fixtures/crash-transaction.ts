import Database from 'better-sqlite3';

// Fault fixture intentionally leaves an SQL transaction open for a parent SIGKILL.
// Production transactions never span asynchronous work.
const db = new Database(process.argv[2]!);
db.pragma('journal_mode=WAL');
db.pragma('synchronous=FULL');
db.exec('BEGIN IMMEDIATE');
db.prepare('INSERT INTO server_metadata (key, value_json) VALUES (?, ?)').run(
  'uncommittedEvidence',
  'true',
);
process.stdout.write('transaction-open\n');
process.stdin.resume();
