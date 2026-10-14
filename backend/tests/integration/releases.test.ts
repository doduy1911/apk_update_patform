import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, utimes, writeFile, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/app.js';
import { cleanupStaleApkFiles } from '../../src/storage/cleanup.js';
import type { ApkMetadata } from '../../src/apk/inspect.js';
import { hashPassword } from '../../src/auth/passwords.js';
import { revokeAdminToken } from '../../src/auth/tokens.js';
import { createAdminToken } from '../../src/auth/tokens.js';
import { loadConfig } from '../../src/config.js';
import { resetAndMigrateTestDatabase, testPool } from './test-db.js';

const signerA = 'a'.repeat(64);
const signerB = 'b'.repeat(64);
const makeMetadata = (versionCode = 1, signingCertSha256 = signerA): ApkMetadata => ({
  packageName: 'com.example.app', versionCode, versionName: `v${versionCode}`, minSdk: 23,
  supportedAbis: ['arm64-v8a'], signingCertSha256,
});

describe('APK release publishing', () => {
  let app: ReturnType<typeof createApp>;
  let storageDir: string;
  let appId: string;
  let token: string;
  let inspect: (path: string) => Promise<ApkMetadata>;

  beforeEach(async () => {
    await resetAndMigrateTestDatabase();
    storageDir = await mkdtemp(path.join(os.tmpdir(), 'apk-publish-test-'));
    const passwordHash = await hashPassword('Correct-Pass-123!');
    const admin = await testPool.query<{ id: string }>(
      'INSERT INTO admin_users (username, password_hash) VALUES ($1,$2) RETURNING id', ['admin', passwordHash],
    );
    const appRow = await testPool.query<{ id: string }>(
      'INSERT INTO apps (name, package_name) VALUES ($1,$2) RETURNING id', ['Example', 'com.example.app'],
    );
    appId = appRow.rows[0]!.id;
    token = (await createAdminToken(testPool, admin.rows[0]!.id, 'test upload')).value;
    inspect = async (filePath) => {
      const contents = await readFile(filePath, 'utf8');
      if (!contents.startsWith('valid:')) throw new Error('APK signature verification failed');
      const [, signerLabel, version] = contents.split(':');
      return makeMetadata(Number(version), signerLabel === 'b' ? signerB : signerA);
    };
    const config = loadConfig({
      NODE_ENV: 'test', PORT: '3000', DATABASE_URL: 'postgres://test:test@localhost:5432/test_db',
      SESSION_SECRET: 'test-session-secret-that-is-long-enough', PUBLIC_BASE_URL: 'https://updates.example.test',
      APK_STORAGE_DIR: storageDir, MAX_APK_BYTES: '128', ADMIN_ORIGIN: 'http://localhost:5173',
    });
    app = createApp({ pool: testPool, config, inspectApk: inspect });
  });

  afterEach(async () => { if (storageDir) await rm(storageDir, { recursive: true, force: true }); });
  afterAll(async () => { await testPool.end(); });

  const upload = (contents: string, versionName = 'release') => request(app)
    .post(`/api/v1/admin/apps/${appId}/releases`)
    .set('Authorization', `Bearer ${token}`)
    .field('releaseNotes', versionName)
    .attach('apk', Buffer.from(contents), 'untrusted-name.apk');

  it('authenticates uploads and rejects invalid APKs and oversized files', async () => {
    await request(app).post(`/api/v1/admin/apps/${appId}/releases`)
      .attach('apk', Buffer.from('valid:a:1'), 'app.apk').expect(401);
    await upload('not-an-apk').expect(422);
    await upload('x'.repeat(160)).expect(413);
    const { rows } = await testPool.query('SELECT id FROM releases');
    expect(rows).toHaveLength(0);
    expect((await readdir(path.join(storageDir, '.staging')))).toHaveLength(0);
  });

  it('supports session uploads with CSRF and rejects revoked upload tokens', async () => {
    const admin = request.agent(app);
    const login = await admin.post('/api/v1/admin/auth/login')
      .send({ username: 'admin', password: 'Correct-Pass-123!' }).expect(200);
    await admin.post(`/api/v1/admin/apps/${appId}/releases`)
      .set('Origin', 'http://localhost:5173')
      .field('releaseNotes', 'browser upload')
      .attach('apk', Buffer.from('valid:a:1'), 'app.apk').expect(403);
    await admin.post(`/api/v1/admin/apps/${appId}/releases`)
      .set('Origin', 'http://localhost:5173').set('X-CSRF-Token', login.body.csrfToken)
      .field('releaseNotes', 'browser upload')
      .attach('apk', Buffer.from('valid:a:1'), 'app.apk').expect(201);
    const userId = (await testPool.query<{ id: string }>('SELECT id FROM admin_users WHERE username=$1', ['admin'])).rows[0]!.id;
    const tokenResult = await createAdminToken(testPool, userId, 'revoked token');
    await revokeAdminToken(testPool, tokenResult.id);
    await request(app).post(`/api/v1/admin/apps/${appId}/releases`)
      .set('Authorization', `Bearer ${tokenResult.value}`)
      .attach('apk', Buffer.from('valid:a:2'), 'app.apk').expect(401);
  });

  it('publishes metadata and a stable URL and rejects duplicate version codes', async () => {
    const first = await upload('valid:a:7', 'first release').expect(201);
    expect(first.body.release).toMatchObject({
      appId, packageName: 'com.example.app', versionCode: 7, versionName: 'v7', releaseNotes: 'first release',
      signingCertSha256: signerA, supportedAbis: ['arm64-v8a'], sizeBytes: 9, status: 'published',
    });
    expect(first.body.release.sha256).toBe(createHash('sha256').update('valid:a:7').digest('hex'));
    expect(first.body.downloadUrl).toBe(`https://updates.example.test/downloads/${first.body.release.id}/app.apk`);
    const apkPath = path.join(storageDir, `${first.body.release.id}.apk`);
    expect(await readFile(apkPath, 'utf8')).toBe('valid:a:7');
    await upload('valid:a:7').expect(409);
    expect((await readdir(storageDir)).filter((item) => item.endsWith('.apk'))).toHaveLength(1);
  });

  it('rejects package mismatch and signing certificate rotation', async () => {
    inspect = async () => ({ ...makeMetadata(1), packageName: 'com.other.app' });
    app = createApp({ pool: testPool, config: loadConfig({
      NODE_ENV: 'test', PORT: '3000', DATABASE_URL: 'postgres://test:test@localhost:5432/test_db',
      SESSION_SECRET: 'test-session-secret-that-is-long-enough', PUBLIC_BASE_URL: 'https://updates.example.test',
      APK_STORAGE_DIR: storageDir, MAX_APK_BYTES: '128', ADMIN_ORIGIN: 'http://localhost:5173',
    }), inspectApk: inspect });
    await upload('valid:a:1').expect(422);
    await testPool.query('UPDATE apps SET signing_cert_sha256=$2 WHERE id=$1', [appId, signerA]);
    inspect = async () => makeMetadata(2, signerB);
    app = createApp({ pool: testPool, config: loadConfig({
      NODE_ENV: 'test', PORT: '3000', DATABASE_URL: 'postgres://test:test@localhost:5432/test_db',
      SESSION_SECRET: 'test-session-secret-that-is-long-enough', PUBLIC_BASE_URL: 'https://updates.example.test',
      APK_STORAGE_DIR: storageDir, MAX_APK_BYTES: '128', ADMIN_ORIGIN: 'http://localhost:5173',
    }), inspectApk: inspect });
    await upload('valid:b:2').expect(422);
    expect((await testPool.query('SELECT id FROM releases')).rows).toHaveLength(0);
  });

  it('serializes concurrent first uploads so only one signing certificate is established', async () => {
    const [first, second] = await Promise.all([upload('valid:a:1'), upload('valid:b:2')]);
    expect([first.status, second.status].sort()).toEqual([201, 422]);
    expect((await testPool.query('SELECT id FROM releases')).rows).toHaveLength(1);
    expect((await readdir(storageDir)).filter((item) => item.endsWith('.apk'))).toHaveLength(1);
  });

  it('removes the stored artifact when the database transaction rolls back', async () => {
    await testPool.query(`CREATE FUNCTION fail_release_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced insert failure'; END $$`);
    await testPool.query('CREATE TRIGGER fail_release_insert BEFORE INSERT ON releases FOR EACH ROW EXECUTE FUNCTION fail_release_insert()');
    await upload('valid:a:3').expect(500);
    expect((await testPool.query('SELECT id FROM releases')).rows).toHaveLength(0);
    expect((await readdir(storageDir)).filter((item) => item.endsWith('.apk'))).toHaveLength(0);
    await testPool.query('DROP TRIGGER fail_release_insert ON releases; DROP FUNCTION fail_release_insert()');
  });

  it('cleans stale staging files and unreferenced APKs without deleting active or published files', async () => {
    const published = await upload('valid:a:4').expect(201);
    const referencedPath = path.join(storageDir, `${published.body.release.id}.apk`);
    const staleOrphanName = `${randomUUID()}.apk`;
    const activeOrphanName = `${randomUUID()}.apk`;
    const staleStage = path.join(storageDir, '.staging', `${randomUUID()}.upload`);
    const activeStage = path.join(storageDir, '.staging', `${randomUUID()}.upload`);
    for (const file of [staleOrphanName, activeOrphanName]) await writeFile(path.join(storageDir, file), 'orphan');
    await writeFile(staleStage, 'stale upload');
    await writeFile(activeStage, 'active upload');
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(path.join(storageDir, staleOrphanName), old, old);
    await utimes(staleStage, old, old);
    const config = loadConfig({
      NODE_ENV: 'test', PORT: '3000', DATABASE_URL: 'postgres://test:test@localhost:5432/test_db',
      SESSION_SECRET: 'test-session-secret-that-is-long-enough', PUBLIC_BASE_URL: 'https://updates.example.test',
      APK_STORAGE_DIR: storageDir, MAX_APK_BYTES: '128', ADMIN_ORIGIN: 'http://localhost:5173',
    });

    await cleanupStaleApkFiles(testPool, config);
    await expect(access(path.join(storageDir, staleOrphanName))).rejects.toThrow();
    await expect(access(staleStage)).rejects.toThrow();
    await expect(access(path.join(storageDir, activeOrphanName))).resolves.toBeUndefined();
    await expect(access(activeStage)).resolves.toBeUndefined();
    await expect(access(referencedPath)).resolves.toBeUndefined();
  });
});
