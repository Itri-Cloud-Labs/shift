// Generates the Shift icon set into OUT: SVG sources, PNGs rendered by Electron, then .icns and .ico.
// Usage: node build.mjs OUT FONT ELECTRON
// OUT is the repository root; FONT is Inter-SemiBold.ttf (from github.com/rsms/inter releases),
// used only to outline the wordmark; ELECTRON is the Electron binary; xvfb-run must exist.
// Needs opentype.js, which the repository does not depend on yet.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const [OUT, FONT, ELECTRON] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [join(here, 'svgs.mjs'), OUT, FONT], { stdio: 'inherit' });

const res = join(OUT, 'apps/app/resources');
const work = join(tmpdir(), 'shift-icons-raster');
rmSync(work, { recursive: true, force: true });
const jobs = [];
const job = (svg, png, size) => jobs.push({ svg: join(OUT, svg), png, size });
const small = 'apps/app/resources/icon-small.svg';
const generic = 'apps/app/resources/icon.svg';
const mac = 'apps/app/resources/icon-mac.svg';

// Linux: a size per file, as electron-builder and desktop entries expect.
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024])
  job(size <= 32 ? small : generic, join(res, 'icons', `${size}x${size}.png`), size);
job(generic, join(res, 'icon.png'), 1024);
// macOS and Windows parts, packed below.
for (const size of [16, 32, 64, 128, 256, 512, 1024])
  job(size <= 32 ? small : mac, join(work, `mac-${size}.png`), size);
for (const size of [16, 24, 32, 48, 64, 128, 256])
  job(size <= 32 ? small : generic, join(work, `win-${size}.png`), size);
for (const size of [16, 32, 48]) job(small, join(work, `fav-${size}.png`), size);
// Tray: 16 pt and its @2x. Electron treats a name ending in "Template" as a macOS template image.
for (const [name, svg] of [
  ['trayTemplate', 'tray/tray-template.svg'],
  ['tray-on-dark', 'tray/tray-on-dark.svg'],
  ['tray-on-light', 'tray/tray-on-light.svg'],
]) {
  job(`apps/app/resources/${svg}`, join(res, 'tray', `${name}.png`), 16);
  job(`apps/app/resources/${svg}`, join(res, 'tray', `${name}@2x.png`), 32);
}
job('docs/brand/shift-mark.svg', join(OUT, 'docs/brand/shift-mark-512.png'), 512);
job('docs/brand/shift-mark-on-light.svg', join(OUT, 'docs/brand/shift-mark-on-light-512.png'), 512);

mkdirSync(work, { recursive: true });
const jobsFile = join(work, 'jobs.json');
writeFileSync(jobsFile, JSON.stringify(jobs));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
execFileSync('xvfb-run', ['-a', ELECTRON, '--no-sandbox', join(here, 'raster.cjs'), jobsFile], {
  stdio: 'inherit',
  env,
});

// .icns: PNG-compressed entries (macOS 10.7 and later read all of these).
const icnsTypes = [
  ['icp4', 16],
  ['icp5', 32],
  ['ic11', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic13', 256],
  ['ic08', 256],
  ['ic14', 512],
  ['ic09', 512],
  ['ic10', 1024],
];
const chunks = icnsTypes.map(([type, size]) => {
  const data = readFileSync(join(work, `mac-${size}.png`));
  const head = Buffer.alloc(8);
  head.write(type, 0, 'ascii');
  head.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([head, data]);
});
const body = Buffer.concat(chunks);
const icnsHead = Buffer.alloc(8);
icnsHead.write('icns', 0, 'ascii');
icnsHead.writeUInt32BE(body.length + 8, 4);
writeFileSync(join(res, 'icon.icns'), Buffer.concat([icnsHead, body]));

// .ico: PNG entries (Windows Vista and later).
function ico(sizes, prefix, target) {
  const images = sizes.map((size) => readFileSync(join(work, `${prefix}-${size}.png`)));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map((image, index) => {
    const size = sizes[index];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.length;
    return entry;
  });
  writeFileSync(target, Buffer.concat([header, ...entries, ...images]));
}
ico([16, 24, 32, 48, 64, 128, 256], 'win', join(res, 'icon.ico'));
ico([16, 32, 48], 'fav', join(OUT, 'docs/brand/favicon.ico'));
console.log('done');
