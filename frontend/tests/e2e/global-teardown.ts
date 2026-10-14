import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default function globalTeardown() {
  const frontendDir = path.dirname(fileURLToPath(import.meta.url));
  const backendDir = path.resolve(frontendDir, '../../../backend');
  spawnSync('docker', ['compose', '--profile', 'test', 'rm', '-sf', 'api-e2e'], {
    cwd: backendDir,
    stdio: 'ignore',
  });
}
