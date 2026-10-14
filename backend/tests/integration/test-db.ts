import { Pool } from 'pg';
import { runner } from 'node-pg-migrate';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL must point to the isolated apk_update_test database');
export const testPool = new Pool({ connectionString: databaseUrl });
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function resetAndMigrateTestDatabase() {
  const { rows } = await testPool.query<{ current_database: string }>('SELECT current_database()');
  if (rows[0]?.current_database !== 'apk_update_test') {
    throw new Error('Refusing schema reset: integration tests require database apk_update_test');
  }
  await testPool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await runner({
    databaseUrl: databaseUrl!,
    dir: migrationsDir,
    direction: 'up',
    migrationsTable: 'schema_migrations',
    verbose: false,
  });
}
