import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { createAdminToken } from '../auth/tokens.js';

const [username, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(' ').trim();
if (!username || !name) {
  console.error('Usage: npm run token:create -- <admin-username> <token-name>');
  process.exitCode = 2;
} else {
  const pool = createPool(loadConfig());
  try {
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM admin_users WHERE username=$1', [username.toLowerCase()]);
    if (!rows[0]) throw new Error('Admin account not found.');
    const token = await createAdminToken(pool, rows[0].id, name);
    console.info(`Token ID: ${token.id}\nToken (shown once): ${token.value}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not create token.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
