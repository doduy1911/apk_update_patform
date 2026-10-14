import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { revokeAdminToken } from '../auth/tokens.js';

const [id] = process.argv.slice(2);
if (!id) {
  console.error('Usage: npm run token:revoke -- <token-id>');
  process.exitCode = 2;
} else {
  const pool = createPool(loadConfig());
  try {
    if (!await revokeAdminToken(pool, id)) throw new Error('Active token not found.');
    console.info(`Token ${id} revoked.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not revoke token.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
