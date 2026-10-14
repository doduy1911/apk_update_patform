import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, rm } from 'node:fs/promises';
import { Pool } from 'pg';
import { runner } from 'node-pg-migrate';
import { createAdmin } from '../dist/auth/router.js';

const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== 'postgres-test' || databaseUrl.pathname !== '/apk_update_test'
    || decodeURIComponent(databaseUrl.username) !== 'apk_update_test') {
  throw new Error('Refusing E2E reset: expected the isolated apk_update_test database service');
}
if (process.env.APK_STORAGE_DIR !== '/data/apks') throw new Error('Refusing E2E storage reset outside /data/apks');

const pool = new Pool({ connectionString: databaseUrl.toString() });
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
try {
  const { rows } = await pool.query('SELECT current_database()');
  if (rows[0]?.current_database !== 'apk_update_test') throw new Error('Refusing to reset a non-test database');
  for (const entry of await readdir('/data/apks')) await rm(path.join('/data/apks', entry), { recursive: true, force: true });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await runner({
    databaseUrl: databaseUrl.toString(), dir: migrationsDir, direction: 'up',
    migrationsTable: 'schema_migrations', verbose: false,
  });
  await createAdmin(pool, 'e2e-admin', 'E2e-Only-Password-123!');
} finally { await pool.end(); }
