import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standalone from 'ajv/dist/standalone/index.js';
import { compile } from 'json-schema-to-typescript';
import { build } from 'esbuild';
import { format, resolveConfig } from 'prettier';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const check = process.argv.includes('--check');
const serverDirectory = fileURLToPath(new URL('../', import.meta.url));
const schemaPath = join(serverDirectory, 'src/protocol/schemas/foundation.schema.json');
const fixturePath = join(serverDirectory, 'test/fixtures/protocol/foundation.json');
// Explicit input allowlist: generation never imports the composition root or catalog executors.
const schemaBytes = await readFile(schemaPath, 'utf8');
const fixtureBytes = await readFile(fixturePath, 'utf8');
const schema = JSON.parse(schemaBytes);
const fixture = JSON.parse(fixtureBytes);
const ajv = new Ajv2020({
  strict: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
  code: { source: true, esm: true },
});
addFormats(ajv, { formats: ['uuid', 'date-time'], mode: 'fast' });
ajv.addSchema(schema);
const names = [
  'ServerInfo',
  'ServerHealth',
  'ProtocolError',
  'ShutdownAcknowledgement',
  'ServerIdentity',
];
const definitions = Object.fromEntries(
  names.map((name) => [`validate${name}`, `${schema.$id}#/$defs/${name}`]),
);
for (const [name, value] of [
  ['ServerInfo', fixture.info],
  ['ServerHealth', fixture.health],
  ['ProtocolError', fixture.error],
  ['ShutdownAcknowledgement', fixture.shutdown],
]) {
  if (!ajv.getSchema(`${schema.$id}#/$defs/${name}`)(value))
    throw new Error(`Invalid ${name} fixture`);
}
// Bundle the pure formats/runtime helper data into standalone code. No renderer Ajv compiler.
const standaloneCode = standalone.default(ajv, definitions);
const bundled = await build({
  stdin: { contents: standaloneCode, resolveDir: serverDirectory, sourcefile: 'validators.js' },
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2023',
  write: false,
  legalComments: 'none',
  logLevel: 'silent',
});
const validators = bundled.outputFiles[0].text;
if (/node:|better-sqlite3|drizzle-orm|new Function\b|\beval\s*\(/.test(validators)) {
  throw new Error(
    'Generated validators contain forbidden runtime dependencies or dynamic code evaluation',
  );
}
const types = await compile(schema, 'FoundationPayload', {
  cwd: join(serverDirectory, 'src/protocol/schemas'),
  unreachableDefinitions: true,
  bannerComment: '/* Generated from foundation.schema.json. Do not edit. */',
  $refOptions: { resolve: { http: false } },
});
const validatorDeclarations = `/* Generated. Do not edit. */
import type { ${names.join(', ')} } from './types.js';

export interface ValidationDiagnostic {
  instancePath: string;
  keyword: string;
  message?: string;
}

export interface Validator<T> {
  (value: unknown): value is T;
  errors?: readonly ValidationDiagnostic[] | null;
}

${names.map((name) => `export const validate${name}: Validator<${name}>;`).join('\n')}
`;
const manifest = {
  protocolVersion: 0,
  payloadSchemaVersion: 1,
  sources: {
    'foundation.schema.json': createHash('sha256').update(schemaBytes).digest('hex'),
    'foundation.fixture.json': createHash('sha256').update(fixtureBytes).digest('hex'),
  },
  generators: Object.fromEntries(
    await Promise.all(
      ['ajv', 'ajv-formats', 'json-schema-to-typescript', 'esbuild', 'prettier'].map(
        async (name) => {
          const path = import.meta.resolve(`${name}/package.json`);
          return [name, JSON.parse(await readFile(new URL(path), 'utf8')).version];
        },
      ),
    ),
  ),
};
const files = new Map([
  ['types.d.ts', types],
  ['validators.js', `/* Generated. Do not edit. */\n${validators}\n`],
  ['validators.d.ts', validatorDeclarations],
  ['foundation.schema.json', schemaBytes],
  ['foundation.fixture.json', fixtureBytes],
  ['manifest.json', `${JSON.stringify(manifest, null, 2)}\n`],
]);
const formatting = await resolveConfig(schemaPath);
for (const [name, bytes] of files) {
  files.set(name, await format(bytes, { ...formatting, filepath: name }));
}
const temporary = await mkdtemp(join(tmpdir(), 'shift-protocol-'));
try {
  for (const [name, bytes] of files) await writeFile(join(temporary, name), bytes);
  for (const target of [
    join(serverDirectory, 'src/protocol/generated'),
    fileURLToPath(new URL('../../app/src/protocol/generated/', import.meta.url)),
  ]) {
    if (!check) await mkdir(target, { recursive: true });
    const existing = await readdir(target).catch(() => []);
    if (check && (existing.length !== files.size || existing.some((name) => !files.has(name)))) {
      throw new Error(`Protocol file set drift in ${target}; run pnpm protocol:generate`);
    }
    for (const [name, bytes] of files) {
      if (check) {
        if ((await readFile(join(target, name), 'utf8').catch(() => '')) !== bytes) {
          throw new Error(`Protocol drift in ${target}/${name}; run pnpm protocol:generate`);
        }
      } else {
        await writeFile(join(target, name), bytes);
      }
    }
  }
  console.log(`Protocol ${check ? 'check' : 'generation'} passed.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
