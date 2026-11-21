# Shift icons

The app icon and tray icons the desktop packages use, generated from the SVG sources here.

- `icon.icns` (macOS, Apple's icon grid with its shadow), `icon.ico` (Windows, 16 to 256 px),
  `icons/NxN.png` (Linux, 16 to 1024 px) and `icon.png` (1024 px).
- `icon.svg`, `icon-mac.svg` and `icon-small.svg` are the sources. Sizes up to 32 px use
  `icon-small.svg`, a larger mark with a wider gap, so the two squares stay apart.
- `tray/`: `trayTemplate.png` for the macOS menu bar (black; macOS tints it), and
  `tray-on-dark` and `tray-on-light` for Windows and Linux. The app has no tray icon yet.

The mark and wordmark for other uses are in [docs/brand](../../../docs/brand).

Colors come from the app's tokens: ink `#ecefed` and green `#61da92` on dark, ink `#141a17` and
green `#007840` on light, tile `oklch(0.19 0.007 160)`.

`node tools/icons/build.mjs` regenerates everything with Electron. Outlining the wordmark needs
`opentype.js`, which is not a dependency of the app: add it temporarily to rebuild the lockups.
