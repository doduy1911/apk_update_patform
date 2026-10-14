import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { runner } from 'node-pg-migrate';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDatabaseReadiness } from '../../src/db/readiness.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL must point to the isolated apk_update_test database');
const pool = new Pool({ connectionString: databaseUrl });
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

async function ensureIsolatedTestDatabase() {
  const { rows } = await pool.query<{ current_database: string }>('SELECT current_database()');
  if (rows[0]?.current_database !== 'apk_update_test') {
    throw new Error('Refusing schema reset: integration tests require database apk_update_test');
  }
}

async function resetPublicSchema() {
  await ensureIsolatedTestDatabase();
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
}

async function migrate(direction: 'up' | 'down' = 'up') {
  return runner({
    databaseUrl: databaseUrl!,
    dir: migrationsDir,
    direction,
    migrationsTable: 'schema_migrations',
    verbose: false,
  });
}

describe('database migrations', () => {
  beforeEach(resetPublicSchema);
  afterAll(async () => { await pool.end(); });

  it('creates all required tables and becomes ready from an empty database', async () => {
    expect(await checkDatabaseReadiness(pool)).toBe(false);
    await migrate();
    const { rows } = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
    );
    expect(new Set(rows.map((row) => row.table_name))).toEqual(new Set([
      'schema_migrations', 'admin_users', 'admin_sessions', 'apps', 'releases', 'admin_api_tokens',
    ]));
    expect(await checkDatabaseReadiness(pool)).toBe(true);
  });

  it('is idempotent when migrations are run again', async () => {
    await migrate();
    await pool.query("INSERT INTO apps (name, package_name) VALUES ('TubeLite', 'com.tubelite')");
    await migrate();
    const { rows } = await pool.query('SELECT package_name FROM apps');
    const migrationRows = await pool.query('SELECT name FROM schema_migrations');
    expect(rows).toEqual([{ package_name: 'com.tubelite' }]);
    expect(migrationRows.rowCount).toBe(1);
  });

  it('is not ready when the schema exists without an applied migration version', async () => {
    await migrate();
    await pool.query('DELETE FROM schema_migrations');
    expect(await checkDatabaseReadiness(pool)).toBe(false);
  });

  it('enforces unique app packages and release version codes per app', async () => {
    await migrate();
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO apps (name, package_name) VALUES ('TubeLite', 'com.tubelite') RETURNING id",
    );
    const appId = rows[0]!.id;
    const insertRelease = () => pool.query(
      `INSERT INTO releases (app_id, version_code, version_name, min_sdk, supported_abis,
        file_key, sha256, signing_cert_sha256, file_size_bytes)
       VALUES ($1, 3, '2.1.0', 26, ARRAY['arm64-v8a'], 'release-1.apk', repeat('a', 64), repeat('b', 64), 1024)`,
      [appId],
    );
    await insertRelease();
    await expect(insertRelease()).rejects.toMatchObject({ code: '23505' });
    await expect(pool.query("INSERT INTO apps (name, package_name) VALUES ('Duplicate', 'com.tubelite')"))
      .rejects.toMatchObject({ code: '23505' });
    await expect(pool.query(
      `INSERT INTO releases (app_id, version_code, version_name, min_sdk, supported_abis,
        file_key, sha256, signing_cert_sha256, file_size_bytes)
       VALUES ($1, 4, '2.2.0', 26, ARRAY[]::text[], 'orphan.apk', repeat('c', 64), repeat('d', 64), 1024)`,
      ['00000000-0000-0000-0000-000000000000'],
    )).rejects.toMatchObject({ code: '23503' });
  });

  it('can roll back and reapply the latest migration in the isolated database', async () => {
    await migrate();
    await migrate('down');
    expect(await checkDatabaseReadiness(pool)).toBe(false);
    await migrate();
    expect(await checkDatabaseReadiness(pool)).toBe(true);
  });
});
