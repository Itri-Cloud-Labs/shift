// The test fake GitHub as a process, for screenshots: prints its origin and App key as one JSON
// line, then serves until killed. One check run on the fake's pull request heads stays in
// progress, so a Wait for Checks keeps polling.
import { FakeGitHub } from '../github-fake.js';

const fake = new FakeGitHub({ now: () => Date.now() });
const origin = await fake.start();
fake.checkRuns.push(
  { id: 1, name: 'build', head_sha: 'f'.repeat(40), status: 'in_progress', conclusion: null },
  { id: 2, name: 'lint', head_sha: 'f'.repeat(40), status: 'completed', conclusion: 'success' },
);
fake.statuses.push({ context: 'deploy/preview', state: 'success', sha: 'f'.repeat(40) });
process.stdout.write(
  `${JSON.stringify({ origin, appId: fake.appId, privateKey: fake.privateKey })}\n`,
);
process.on('SIGTERM', () => void fake.stop().then(() => process.exit(0)));
