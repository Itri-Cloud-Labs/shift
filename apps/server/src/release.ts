import Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { migrationsDirectory, verifySqliteRuntime } from './persistence/runtime.js';
import { protocolRange, serverVersion } from './protocol/index.js';

// Written by packaging/bundle.mjs at the root of an installed release, next to `app/`.
export interface ReleaseManifest {
  name: 'shift-server';
  version: string;
  commit: string;
  platform: 'linux';
  arch: 'x64' | 'arm64';
  libc: 'glibc';
  minimumGlibc: string;
  node: string;
}

export interface Release {
  root: string;
  manifest: ReleaseManifest;
}

// The release this server runs from, or null for a development build.
export async function installedRelease(): Promise<Release | null> {
  const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
  try {
    const manifest = JSON.parse(await readFile(`${root}/MANIFEST.json`, 'utf8')) as ReleaseManifest;
    return manifest.name === 'shift-server' ? { root, manifest } : null;
  } catch {
    return null;
  }
}

export interface VersionReport {
  version: string;
  commit: string | null;
  release: boolean;
  arch: string;
  node: string;
  sqlite: string;
  migrations: number;
  protocol: { min: number; max: number };
}

// Loads the native SQLite binding, so a report proves this runtime can open the database.
export async function versionReport(): Promise<VersionReport> {
  const release = await installedRelease();
  const db = new Database(':memory:');
  let sqlite: { version: string; sourceId: string };
  try {
    sqlite = db
      .prepare('SELECT sqlite_version() AS version, sqlite_source_id() AS sourceId')
      .get() as { version: string; sourceId: string };
  } finally {
    db.close();
  }
  verifySqliteRuntime(sqlite);
  return {
    version: release?.manifest.version ?? serverVersion,
    commit: release?.manifest.commit ?? null,
    release: release !== null,
    arch: process.arch,
    node: process.version,
    sqlite: sqlite.version,
    migrations: readMigrationFiles({ migrationsFolder: migrationsDirectory }).length,
    protocol: { ...protocolRange },
  };
}
