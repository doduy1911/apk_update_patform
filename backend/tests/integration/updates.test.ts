import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/auth/passwords.js';
import { loadConfig } from '../../src/config.js';
import { resetAndMigrateTestDatabase, testPool } from './test-db.js';

const config = loadConfig({
  NODE_ENV: 'test', PORT: '3000', DATABASE_URL: 'postgres://test:test@localhost:5432/test_db',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough', PUBLIC_BASE_URL: 'https://updates.example.test',
  APK_STORAGE_DIR: '/tmp/apk-update-download-test', MAX_APK_BYTES: '536870912', ADMIN_ORIGIN: 'http://localhost:5173',
});

describe('public update checks', () => {
  let app: ReturnType<typeof createApp>;
  let tubeLiteId: string;

  beforeEach(async () => {
    await resetAndMigrateTestDatabase();
    const adminHash = await hashPassword('Correct-Pass-123!');
    await testPool.query('INSERT INTO admin_users (username, password_hash) VALUES ($1,$2)', ['admin', adminHash]);
    tubeLiteId = (await testPool.query<{ id: string }>(
      'INSERT INTO apps (name, package_name) VALUES ($1,$2) RETURNING id', ['TubeLite', 'com.tubelite'],
    )).rows[0]!.id;
    app = createApp({ pool: testPool, config });
  });

  afterAll(async () => { await testPool.end(); });

  async function seed(appId: string, versionCode: number, minSdk: number, supportedAbis: string[], status = 'published') {
    return (await testPool.query<{ id: string }>(
      `INSERT INTO releases (app_id, version_code, version_name, min_sdk, supported_abis, file_key,
        sha256, signing_cert_sha256, file_size_bytes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [appId, versionCode, `${versionCode}.0`, minSdk, supportedAbis, `seed-${appId}-${versionCode}.apk`,
        'a'.repeat(64), 'b'.repeat(64), 4, status],
    )).rows[0]!.id;
  }

  it('returns only the highest update compatible with SDK and ABI for the requested package', async () => {
    const otherAppId = (await testPool.query<{ id: string }>(
      'INSERT INTO apps (name, package_name) VALUES ($1,$2) RETURNING id', ['Other', 'com.other.app'],
    )).rows[0]!.id;
    const olderCompatible = await seed(tubeLiteId, 3, 23, ['arm64-v8a']);
    await seed(tubeLiteId, 4, 35, ['x86_64']);
    const otherAppRelease = await seed(otherAppId, 99, 21, []);
    await seed(tubeLiteId, 5, 26, [], 'withdrawn');

    const result = await request(app).post('/api/v1/updates/check').send({
      packageName: 'com.tubelite', currentVersionCode: 2, sdkInt: 34, supportedAbis: ['arm64-v8a'],
    }).expect(200);
    expect(result.body).toMatchObject({ updateAvailable: true, release: {
      id: olderCompatible, packageName: 'com.tubelite', versionCode: 3, versionName: '3.0',
      downloadUrl: `https://updates.example.test/downloads/${olderCompatible}/app.apk`, sizeBytes: 4,
    } });
    expect(result.body.release.id).not.toBe(otherAppRelease);
  });

  it('reports current, no compatible version and unknown app distinctly', async () => {
    await seed(tubeLiteId, 5, 35, ['x86_64']);
    await seed(tubeLiteId, 6, 21, ['x86']);
    const upToDate = await request(app).post('/api/v1/updates/check').send({
      packageName: 'com.tubelite', currentVersionCode: 6, sdkInt: 34, supportedAbis: ['arm64-v8a'],
    }).expect(200);
    expect(upToDate.body).toEqual({ updateAvailable: false, release: null, reason: 'UP_TO_DATE' });

    const incompatible = await request(app).post('/api/v1/updates/check').send({
      packageName: 'com.tubelite', currentVersionCode: 4, sdkInt: 34, supportedAbis: ['arm64-v8a'],
    }).expect(200);
    expect(incompatible.body).toEqual({ updateAvailable: false, release: null, reason: 'NO_COMPATIBLE_RELEASE' });

    const higherClientVersion = await request(app).post('/api/v1/updates/check').send({
      packageName: 'com.tubelite', currentVersionCode: 9, sdkInt: 35, supportedAbis: ['x86_64'],
    }).expect(200);
    expect(higherClientVersion.body).toEqual({ updateAvailable: false, release: null, reason: 'UP_TO_DATE' });

    const missing = await request(app).post('/api/v1/updates/check').send({
      packageName: 'com.missing.app', currentVersionCode: 1, sdkInt: 35, supportedAbis: ['arm64-v8a'],
    }).expect(404);
    expect(missing.body.error.code).toBe('APP_NOT_FOUND');
  });

  it('returns up to date when no release exists and validates device metadata', async () => {
    await request(app).post('/api/v1/updates/check').send({
      packageName: 'com.tubelite', currentVersionCode: 2, sdkInt: 35, supportedAbis: ['arm64-v8a'],
    }).expect(200).expect(({ body }) => expect(body.reason).toBe('UP_TO_DATE'));
    await request(app).post('/api/v1/updates/check').send({
      packageName: 'com.tubelite', currentVersionCode: -1, sdkInt: 35, supportedAbis: [],
    }).expect(400);
  });
});
