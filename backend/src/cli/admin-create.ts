import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { createAdmin } from '../auth/router.js';

function readHiddenPassword(): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('Run this command in an interactive terminal so the password can be entered without echo.');
  }
  process.stdout.write('New admin password: ');
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      input.setRawMode(false);
      input.pause();
      input.off('data', onData);
      process.stdout.write('\n');
    };
    const onData = (chunk: Buffer) => {
      const key = chunk.toString('utf8');
      if (key === '\u0003') {
        cleanup();
        reject(new Error('Cancelled.'));
      } else if (key === '\r' || key === '\n') {
        cleanup();
        resolve(value);
      } else if (key === '\u007f' || key === '\b') {
        value = value.slice(0, -1);
        process.stdout.write('\b \b');
      } else if (!key.startsWith('\u001b') && value.length + key.length <= 1024) {
        value += key;
        process.stdout.write('*'.repeat(key.length));
      }
    };
    input.on('data', onData);
  });
}

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

