import { Pool } from 'pg';
import type { AppConfig } from '../config.js';

export function createPool(config: Pick<AppConfig, 'databaseUrl'>) {
  const pool = new Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30000 });
  pool.on('error', (error) => {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
    console.error('Unexpected PostgreSQL pool client error', { code });
  });
  return pool;
}
