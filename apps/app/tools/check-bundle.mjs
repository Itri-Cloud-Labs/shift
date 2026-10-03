import { readdir, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
await mkdir(join(root, 'licenses'), { recursive: true });
await cp(
  new URL('../node_modules/@fontsource-variable/dm-sans/LICENSE', import.meta.url),
  join(root, 'licenses/dm-sans.txt'),
);
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)],
      ),
    )
  ).flat();
}
const assets = {};
for (const file of await files(root)) {
  const path = relative(root, file).replaceAll('\\', '/');
  if (/\.node$|node_modules|apps\/server/.test(path))
    throw new Error(`Forbidden bundled file: ${path}`);
  if (/\.(js|cjs|mjs)$/.test(path)) {
    const source = await readFile(file, 'utf8');
    if (
      /better-sqlite3|drizzle-orm|fs-native-extensions|apps\/server|child_process|opencode/.test(
        source,
      )
    )
      throw new Error(`Backend dependency in ${path}`);
    const syntax = parse(source, {
      ecmaVersion: 'latest',
      sourceType: path.endsWith('.cjs') ? 'script' : 'module',
    });
    const imports = [];
    let dynamicCode = false;
    simple(syntax, {
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments[0]?.type === 'Literal'
        )
          imports.push(node.arguments[0].value);
        if (node.callee.type === 'Identifier' && ['eval', 'Function'].includes(node.callee.name))
          dynamicCode = true;
      },
      ImportExpression() {
        imports.push('dynamic-import');
      },
      ImportDeclaration(node) {
        imports.push(node.source.value);
      },
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Function')
          dynamicCode = true;
      },
    });
    if (
      path.startsWith('renderer/') &&
      (imports.length || dynamicCode || /from\s*["'](?:electron|node:)/.test(source))
    )
      throw new Error(`Privileged code in ${path}`);
    if (path.startsWith('preload/') && imports.some((name) => name !== 'electron'))
      throw new Error('Preload must be a single sandbox-compatible bundle');
  }
  if (path.startsWith('renderer/')) {
    const extension = path.split('.').at(-1);
    const mime = {
      html: 'text/html; charset=utf-8',
      js: 'text/javascript; charset=utf-8',
      css: 'text/css; charset=utf-8',
      woff2: 'font/woff2',
      woff: 'font/woff',
      svg: 'image/svg+xml',
    }[extension];
    if (!mime) throw new Error(`Unexpected renderer asset: ${path}`);
    assets[path.slice('renderer/'.length)] = mime;
  }
}
if (!assets['index.html']) throw new Error('Missing renderer entry');
await writeFile(join(root, 'renderer-assets.json'), JSON.stringify(assets, null, 2) + '\n');
console.log(`App bundle checked; ${Object.keys(assets).length} allowlisted renderer assets.`);
