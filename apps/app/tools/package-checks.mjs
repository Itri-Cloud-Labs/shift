// What the packaged app may contain, kept apart from the script so tests can feed it archives.

export // An asar archive: a little-endian size prefix, a JSON index of files with their offsets, then
// the file bytes. Read directly, so the check needs no packaging library of its own.
function readArchive(buffer) {
  const indexSize = buffer.readUInt32LE(12);
  const index = JSON.parse(buffer.subarray(16, 16 + indexSize).toString('utf8'));
  const base = 8 + buffer.readUInt32LE(4);
  const files = new Map();
  const walk = (node, prefix) => {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (entry.files) walk(entry, path);
      else if (entry.unpacked) files.set(path, null);
      // A link is recorded with a sentinel, so the path rules still see it and refuse it.
      else if (entry.link !== undefined) files.set(path, 'link');
      else {
        const start = base + Number(entry.offset);
        files.set(path, buffer.subarray(start, start + entry.size));
      }
    }
  };
  walk(index, '');
  return files;
}

// Problems with an archive's files, by path; `null` bytes mean the file was unpacked.
export function packageProblems(files) {
  const problems = [];
  const allowed = /^(package\.json|dist\/renderer-assets\.json|dist\/(main|preload|renderer)\/.+)$/;
  const forbiddenContent = [
    [/better-sqlite3|drizzle-orm|fs-native-extensions/, 'a server storage module'],
    [/apps\/server|opencode serve/, 'server or harness code'],
    // Key material after the header; the GitHub App form shows the header alone as a placeholder.
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+/=]{40,}/, 'a private key'],
    [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'a GitHub token'],
    [/\bsk-[A-Za-z0-9_-]{32,}/, 'an API key'],
    [/localhost:5173|ELECTRON_RENDERER_URL/, 'a development server address'],
  ];
  for (const [path, bytes] of files) {
    if (!allowed.test(path)) problems.push(`unexpected file ${path}`);
    if (/\.node$|node_modules|\.env(\.|$)|\.map$/.test(path))
      problems.push(`forbidden file ${path}`);
    if (bytes === 'link') {
      problems.push(`${path} is a symbolic link`);
      continue;
    }
    if (bytes === null) {
      problems.push(`${path} is unpacked outside the archive`);
      continue;
    }
    if (!/\.(js|cjs|mjs|json|html|css)$/.test(path)) continue;
    const text = bytes.toString('utf8');
    for (const [pattern, what] of forbiddenContent)
      if (pattern.test(text)) problems.push(`${path} contains ${what}`);
  }

  const manifest = JSON.parse(files.get('package.json')?.toString('utf8') ?? '{}');
  for (const key of ['devDependencies', 'dependencies', 'scripts'])
    if (manifest[key] && Object.keys(manifest[key]).length > 0)
      problems.push(`package.json ships its ${key}`);
  const main = [...files]
    .filter(([path]) => path.startsWith('dist/main/') && path.endsWith('.js'))
    .map(([, bytes]) => bytes?.toString('utf8') ?? '')
    .join('\n');
  for (const lock of ['setWindowOpenHandler', 'will-navigate', 'contextIsolation', 'sandbox'])
    if (!main.includes(lock)) problems.push(`the main process lacks ${lock}`);
  if (!files.has('dist/renderer/index.html')) problems.push('the renderer entry is missing');
  return problems;
}

// What may sit beside app.asar in the packaged resources, per platform: anything else would ship
// unchecked. macOS adds its icon and localization folders, Linux an AppArmor profile for the .deb.
export function resourceProblems(platform, names) {
  const allowed = {
    linux: [/^app\.asar$/, /^apparmor-profile$/],
    win32: [/^app\.asar$/, /^elevate\.exe$/],
    darwin: [/^app\.asar$/, /^icon\.icns$/, /^[A-Za-z0-9_-]+\.lproj$/],
  }[platform];
  return names
    .filter((name) => !allowed.some((pattern) => pattern.test(name)))
    .map((name) => `unexpected resource ${name} beside app.asar`);
}
