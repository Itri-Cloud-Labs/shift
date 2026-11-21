// Builds every Shift brand SVG into OUT (argv[2]). Geometry is on a 64-unit grid: a back square
// and a green square shifted over it, separated by a transparent gap cut with a mask.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const opentype = require('opentype.js');
const OUT = process.argv[2];
const FONT = process.argv[3];

// oklch -> sRGB hex, so files work in tools without CSS Color 4.
function oklch(l, c, h) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const [L, M, S] = [l_ ** 3, m_ ** 3, s_ ** 3];
  const lin = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
  return (
    '#' +
    lin
      .map((v) => {
        const x = Math.min(1, Math.max(0, v));
        const g = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
        return Math.round(g * 255)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}

// The app's own tokens (apps/app/src/client-ui/styles.css).
export const colors = {
  darkInk: oklch(0.95, 0.004, 160),
  darkGreen: oklch(0.8, 0.15, 155),
  lightInk: oklch(0.21, 0.01, 160),
  lightGreen: oklch(0.5, 0.13, 155),
  // One flat tone: a dark gradient bands visibly at 8 bits per channel.
  tile: oklch(0.19, 0.007, 160),
};

// `small` widens the gap and tightens corners so the two shapes stay apart at 16 to 32 px.
function mark({ ink, green, small = false, id = 'm' }) {
  const gap = small ? 6.5 : 5;
  const front = { x: 25, size: 30, r: small ? 6 : 7 };
  const cut = front.x - gap;
  const cutSize = front.size + gap * 2;
  return `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/><rect x="${cut}" y="${cut}" width="${cutSize}" height="${cutSize}" rx="${front.r + gap}" fill="#000"/></mask></defs><rect x="8" y="8" width="32" height="32" rx="${small ? 7 : 8}" fill="${ink}" mask="url(#${id})"/><rect x="${front.x}" y="${front.x}" width="${front.size}" height="${front.size}" rx="${front.r}" fill="${green}"/>`;
}

const svg = (viewBox, body, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${extra}>${body}</svg>\n`;

function write(path, text) {
  const target = join(OUT, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

// Bare marks: for dark backgrounds, for light backgrounds, and one color (currentColor).
const markDark = mark({ ink: colors.darkInk, green: colors.darkGreen });
const markLight = mark({ ink: colors.lightInk, green: colors.lightGreen });
write('docs/brand/shift-mark.svg', svg('6 6 52 52', markDark));
write('docs/brand/shift-mark-on-light.svg', svg('6 6 52 52', markLight));
write(
  'docs/brand/shift-mark-mono.svg',
  svg('6 6 52 52', mark({ ink: 'currentColor', green: 'currentColor' }), ' fill="currentColor"'),
);

// Favicon: follows the page's color scheme.
write(
  'docs/brand/favicon.svg',
  svg(
    '6 6 52 52',
    `<style>.i{fill:${colors.lightInk}}.g{fill:${colors.lightGreen}}@media (prefers-color-scheme: dark){.i{fill:${colors.darkInk}}.g{fill:${colors.darkGreen}}}</style>` +
      mark({ ink: 'inherit', green: 'inherit', small: true })
        .replace(/fill="inherit"/, 'class="i"')
        .replace(/fill="inherit"/, 'class="g"'),
  ),
);

// Lockup: mark plus "Shift" in Inter SemiBold, outlined so it needs no font.
const font = opentype.loadSync(FONT);
const word = font.getPath('Shift', 0, 0, 100);
const box = word.getBoundingBox();
function lockup(ink, green) {
  // Cap height of Inter is about 0.727 em; the mark is drawn a little taller than the caps.
  const markSize = 92;
  const capTop = box.y1;
  const textHeight = box.y2 - box.y1;
  const gapX = 26;
  const offsetX = markSize + gapX - box.x1;
  const offsetY = (markSize - textHeight) / 2 - capTop;
  const path = word.toPathData(2);
  const width = Math.ceil(markSize + gapX + (box.x2 - box.x1));
  return svg(
    `0 0 ${width} ${markSize}`,
    `<svg x="0" y="0" width="${markSize}" height="${markSize}" viewBox="6 6 52 52">${mark({ ink, green, id: 'l' })}</svg><path transform="translate(${offsetX.toFixed(2)} ${offsetY.toFixed(2)})" d="${path}" fill="${ink}"/>`,
  );
}
write('docs/brand/shift-lockup.svg', lockup(colors.darkInk, colors.darkGreen));
write('docs/brand/shift-lockup-on-light.svg', lockup(colors.lightInk, colors.lightGreen));

// App icon tiles on a 1024 canvas. The mark sits on its own dark tile so it shows on light docks
// and taskbars too.
function tile({ inset, radius, markScale, small = false, shadow = false }) {
  const size = 1024 - inset * 2;
  const markPx = size * markScale;
  const at = inset + (size - markPx) / 2;
  const shadowDef = shadow
    ? `<filter id="s" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.32"/></filter>`
    : '';
  return svg(
    '0 0 1024 1024',
    `<defs>${shadowDef}</defs>` +
      `<rect x="${inset}" y="${inset}" width="${size}" height="${size}" rx="${radius}" fill="${colors.tile}"${shadow ? ' filter="url(#s)"' : ''}/>` +
      `<rect x="${inset + 2}" y="${inset + 2}" width="${size - 4}" height="${size - 4}" rx="${radius - 2}" fill="none" stroke="#fff" stroke-opacity="0.08" stroke-width="4"/>` +
      `<svg x="${at}" y="${at}" width="${markPx}" height="${markPx}" viewBox="6 6 52 52">${mark({ ink: colors.darkInk, green: colors.darkGreen, small })}</svg>`,
  );
}
// macOS: Apple's grid, an 824 body inset 100 with a drop shadow.
write(
  'apps/app/resources/icon-mac.svg',
  tile({ inset: 100, radius: 185, markScale: 0.56, shadow: true }),
);
// Windows and Linux: nearly full-bleed.
write('apps/app/resources/icon.svg', tile({ inset: 24, radius: 220, markScale: 0.56 }));
// 16 to 32 px: the mark fills more of the tile and uses the wider gap.
write(
  'apps/app/resources/icon-small.svg',
  tile({ inset: 0, radius: 200, markScale: 0.74, small: true }),
);

// Tray: macOS template (black, the system tints it) and light/dark variants elsewhere.
const trayMark = (color) => svg('6 6 52 52', mark({ ink: color, green: color, small: true }));
write('apps/app/resources/tray/tray-template.svg', trayMark('#000'));
write('apps/app/resources/tray/tray-on-dark.svg', trayMark('#f2f2f2'));
write('apps/app/resources/tray/tray-on-light.svg', trayMark('#1d1f1e'));

console.log(JSON.stringify(colors));
