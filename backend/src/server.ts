import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { cleanupStaleApkFiles } from './storage/cleanup.js';

const config = loadConfig();
const pool = createPool(config);
const app = createApp({ pool, config });

async function start() {
  await cleanupStaleApkFiles(pool, config);
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.info(`API listening on port ${config.port}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => {
        void pool.end().finally(() => process.exit(0));
      });
    });
  }
}

void start();
