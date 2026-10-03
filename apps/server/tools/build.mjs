import { rm, cp, chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('../', import.meta.url));
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
const result = spawnSync('tsc', ['-p', 'tsconfig.build.json'], {
  cwd: workspace,
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);
for (const directory of ['protocol/generated', 'persistence/migrations']) {
  await cp(
    new URL(`../src/${directory}/`, import.meta.url),
    new URL(`../dist/${directory}/`, import.meta.url),
    { recursive: true },
  );
}
await chmod(new URL('../dist/cli.js', import.meta.url), 0o755);
