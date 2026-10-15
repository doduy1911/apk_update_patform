import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { createAdmin } from '../auth/router.js';
import { readHiddenPassword } from './password-prompt.js';

const username = process.argv[2];
if (!username) {
  console.error('Usage: npm run admin:create -- <username>');
  process.exitCode = 2;
} else {
  let pool: ReturnType<typeof createPool> | undefined;
  try {
    const config = loadConfig();
    pool = createPool(config);
    const password = await readHiddenPassword();
    const id = await createAdmin(pool, username, password);
    console.info(`Admin ${username.trim().toLowerCase()} created (${id}).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not create admin.');
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}

