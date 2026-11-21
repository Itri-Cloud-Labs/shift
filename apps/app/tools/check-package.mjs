// Inspects the packaged app as users receive it, after electron-builder: the archive must hold only
// the built client, with no server code, native modules, secrets or development endpoints, and the
// window's navigation lock must be in the shipped main process.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageProblems, readArchive, resourceProblems } from './package-checks.mjs';

const release = fileURLToPath(new URL('../release/', import.meta.url));

async function resourcesDirectory() {
  if (process.platform === 'linux') return join(release, 'linux-unpacked', 'resources');
  if (process.platform === 'win32') return join(release, 'win-unpacked', 'resources');
  const directory = (await readdir(release)).find((name) => /^mac(-arm64)?$/.test(name));
  if (!directory) throw new Error('No macOS app was packaged.');
  return join(release, directory, 'Shift.app', 'Contents', 'Resources');
}

const resources = await resourcesDirectory();
const problems = resourceProblems(process.platform, await readdir(resources));
const files = readArchive(await readFile(join(resources, 'app.asar')));
problems.push(
  ...packageProblems(files, { liveSmoke: process.env['SHIFT_BUILD_LIVE_SMOKE'] === '1' }),
);

if (problems.length) {
  console.error(problems.map((problem) => `✗ ${problem}`).join('\n'));
  process.exit(1);
}
console.log(`Packaged app checked: ${files.size} files in app.asar, nothing unexpected.`);
