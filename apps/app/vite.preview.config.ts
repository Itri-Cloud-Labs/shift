import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vite';
import { createShell } from './src/client-core/fixtures.js';

// Browser inspection only. This bridge is never emitted by the desktop build.
export default defineConfig({
  root: 'dist/renderer',
  preview: { port: 4173, strictPort: true },
  plugins: [
    {
      name: 'shift-browser-fixtures',
      configurePreviewServer(server) {
        const samples = true;
        server.middlewares.use(async (request, response, next) => {
          if (request.url === '/preview-bridge.js') {
            response.setHeader('Content-Type', 'text/javascript');
            response.end(`let state = ${JSON.stringify(createShell(samples))}; window.shift = {
            readShell: async () => ({ kind: 'shell', state }),
            setSamples: async enabled => { state = enabled ? ${JSON.stringify(createShell(true))} : ${JSON.stringify(createShell(false))}; return {kind:'shell',state}; },
            queryServer: async () => ({kind:'error',code:'DISCONNECTED',message:'Connect to a server before querying it.'}),
            openDocumentation: async () => ({kind:'error',code:'UNAVAILABLE',message:'The desktop operation is unavailable.'})
          };`);
          } else if (request.url === '/' || request.url === '/index.html') {
            response.setHeader('Content-Type', 'text/html');
            response.end(
              (await readFile('dist/renderer/index.html', 'utf8')).replace(
                '<head>',
                '<head><script src="/preview-bridge.js"></script>',
              ),
            );
          } else next();
        });
      },
    },
  ],
});
