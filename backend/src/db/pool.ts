import { Pool } from 'pg';
import type { AppConfig } from '../config.js';

export function createPool(config: Pick<AppConfig, 'databaseUrl'>) {
  return new Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30000 });
}
