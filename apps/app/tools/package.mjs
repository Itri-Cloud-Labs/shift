// Builds this platform's desktop installers, then records their checksums and whether they are
// signed. Signing identities come only from protected CI secrets; without them the artifacts are
// built and named unsigned, never presented as a signed distribution.
// Usage: node tools/package.mjs [--dir]   (--dir: the unpacked app only, for smoke tests)
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { Arch, Platform, build } from 'electron-builder';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'release');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const env = process.env;
const dirOnly = process.argv.includes('--dir');
const arch = process.arch === 'arm64' ? Arch.arm64 : Arch.x64;

// macOS needs a Developer ID certificate and notarization credentials together: a signed but
// unnotarized app is refused by Gatekeeper just like an unsigned one, so half a setup is an error.
const macCertificate = Boolean(env['CSC_LINK']);
const macNotary = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'].every(
  (name) => env[name],
);
if (process.platform === 'darwin' && macCertificate !== macNotary)
  throw new Error(
    'macOS signing needs CSC_LINK and APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER together.',
  );
const windowsCertificate = Boolean(env['WIN_CSC_LINK'] ?? env['CSC_LINK']);
const signed =
  process.platform === 'darwin'
    ? macCertificate
    : process.platform === 'win32'
      ? windowsCertificate
      : null;
const suffix = signed === false ? '-unsigned' : '';
const config = {
  ...manifest.build,
  artifactName: `Shift-\${version}-\${os}-\${arch}${suffix}.\${ext}`,
  mac: {
    ...manifest.build.mac,
    ...(signed ? { notarize: true, hardenedRuntime: true } : { identity: null }),
  },
  win: { ...manifest.build.win, signAndEditExecutable: Boolean(signed) },
};
const targets =
  process.platform === 'darwin'
    ? Platform.MAC.createTarget(dirOnly ? ['dir'] : ['dmg', 'zip'], arch)
    : process.platform === 'win32'
      ? Platform.WINDOWS.createTarget(dirOnly ? ['dir'] : ['nsis'], Arch.x64)
      : Platform.LINUX.createTarget(dirOnly ? ['dir'] : ['AppImage', 'deb'], Arch.x64);

await rm(output, { recursive: true, force: true });
await build({ targets, config, publish: 'never' });
if (dirOnly) process.exit(0);

async function sha256(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}
const artifacts = (await readdir(output))
  .filter((name) => /^Shift-.*\.(dmg|zip|exe|AppImage|deb)$/.test(name))
  .sort();
if (artifacts.length === 0) throw new Error('No installer was produced.');
const sums = [];
for (const name of artifacts) sums.push(`${await sha256(join(output, name))}  ${name}`);
await writeFile(join(output, 'SHA256SUMS'), `${sums.join('\n')}\n`);
await writeFile(
  join(output, 'release.json'),
  `${JSON.stringify({ version: manifest.version, platform: process.platform, arch: process.platform === 'win32' ? 'x64' : process.arch, signed, artifacts }, null, 2)}\n`,
);
console.log(JSON.stringify({ artifacts, signed }));
