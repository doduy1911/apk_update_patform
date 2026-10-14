import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgres://test:test@localhost:5432/test_db',
  SESSION_SECRET: 's'.repeat(32),
  PUBLIC_BASE_URL: 'https://updates.example.test',
  APK_STORAGE_DIR: '/tmp/apk-update-test',
  MAX_APK_BYTES: '536870912',
  ADMIN_ORIGIN: 'http://localhost:5173',
};

describe('loadConfig', () => {
  it('loads a valid environment and parses numeric values', () => {
    const config = loadConfig(validEnv);
    expect(config.port).toBe(3000);
    expect(config.maxApkBytes).toBe(536870912);
    expect(config.databaseUrl).toBe(validEnv.DATABASE_URL);
  });

  it('fails with the missing required variable name', () => {
    const { DATABASE_URL: _databaseUrl, ...missingDatabase } = validEnv;
    expect(() => loadConfig(missingDatabase)).toThrow(/DATABASE_URL/);
  });

  it('rejects a weak session secret', () => {
    expect(() => loadConfig({ ...validEnv, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });
});
