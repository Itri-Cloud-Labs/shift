import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

// Fail while the complete module graph is available, before bundling hides imports.
function boundary(area: 'main' | 'preload' | 'renderer'): Plugin {
  return {
    name: `shift-${area}-boundary`,
    moduleParsed(info) {
      const id = info.id.replaceAll('\\', '/');
      if (/apps\/server|better-sqlite3|drizzle-orm|fs-native-extensions|\.node$/.test(id)) {
        this.error(`Backend module in ${area}: ${id}`);
      }
      if (area === 'renderer' && /\/src\/(main|preload|client-core)\//.test(id)) {
        this.error(`Privileged module in renderer: ${id}`);
      }
      for (const imported of [...info.importedIds, ...info.dynamicallyImportedIds]) {
        if (
          (area === 'renderer' || /\/src\/client-core\//.test(id)) &&
          /^(node:|electron$)|__vite-browser-external/.test(imported)
        ) {
          this.error(`Node/Electron import in renderer: ${imported}`);
        }
        if (area === 'preload' && /^(node:|fs$|path$|child_process$)/.test(imported)) {
          this.error(`Unsupported sandbox preload import: ${imported}`);
        }
      }
    },
  };
}
// The packaged-app live test (tools/live-smoke.mjs) is compiled in only when this is set at build
// time; every other build drops it, and tools/check-package.mjs refuses a package that has it.
const liveSmoke = process.env['SHIFT_BUILD_LIVE_SMOKE'] === '1';

export default defineConfig({
  main: {
    plugins: [boundary('main')],
    define: { __SHIFT_LIVE_SMOKE__: JSON.stringify(liveSmoke) },
    build: {
      externalizeDeps: false,
      outDir: 'dist/main',
      rollupOptions: { input: resolve('src/main/index.ts') },
    },
  },
  preload: {
    plugins: [boundary('preload')],
    build: {
      externalizeDeps: false,
      outDir: 'dist/preload',
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.cjs', inlineDynamicImports: true },
      },
    },
  },
  renderer: {
    root: resolve('src/client-ui'),
    base: './',
    plugins: [react(), boundary('renderer')],
    build: {
      outDir: resolve('dist/renderer'),
      minify: true,
      emptyOutDir: true,
      // Loaded from disk in one piece; a code-splitting warning does not apply.
      chunkSizeWarningLimit: 1024,
      rollupOptions: { input: resolve('src/client-ui/index.html') },
    },
  },
});
