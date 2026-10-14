import type { Pool } from 'pg';

const requiredTables = ['schema_migrations', 'admin_users', 'admin_sessions', 'apps', 'releases', 'admin_api_tokens'];

export async function checkDatabaseReadiness(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [requiredTables],
  );
  if (new Set(rows.map((row) => row.table_name)).size !== requiredTables.length) return false;
  const migration = await pool.query('SELECT 1 FROM public.schema_migrations LIMIT 1');
  return migration.rowCount === 1;
}
