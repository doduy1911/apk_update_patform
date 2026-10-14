import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import type { AppConfig } from '../config.js';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const APK_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.apk$/i;

export async function cleanupStaleApkFiles(pool: Pool, config: AppConfig, now = Date.now()) {
  const storageDir = config.apkStorageDir;
  const stagingDir = path.join(storageDir, '.staging');
  const { rows } = await pool.query<{ file_key: string }>('SELECT file_key FROM releases');
  const referencedKeys = new Set(rows.map((row) => row.file_key));
  const cutoff = now - STALE_AFTER_MS;

  await cleanDirectory(stagingDir, (name) => name.endsWith('.upload'), () => true, cutoff);
  await cleanDirectory(storageDir, (name) => APK_KEY.test(name), (name) => !referencedKeys.has(name), cutoff);
}

async function cleanDirectory(
  directory: string,
  matches: (name: string) => boolean,
  shouldDelete: (name: string) => boolean,
  cutoff: number,
) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !matches(entry.name) || !shouldDelete(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    const metadata = await stat(filePath);
    if (metadata.mtimeMs < cutoff) await rm(filePath, { force: true });
  }
}
