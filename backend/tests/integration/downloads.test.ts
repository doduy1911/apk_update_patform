import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/auth/passwords.js';
import { loadConfig } from '../../src/config.js';
import { resetAndMigrateTestDatabase, testPool } from './test-db.js';

const storageDir = '/tmp/apk-update-download-test';
const config = loadConfig({
  NODE_ENV: 'test', PORT: '3000', DATABASE_URL: 'postgres://test:test@localhost:5432/test_db',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough', PUBLIC_BASE_URL: 'https://updates.example.test',
  APK_STORAGE_DIR: storageDir, MAX_APK_BYTES: '536870912', ADMIN_ORIGIN: 'http://localhost:5173',
});

describe('public APK downloads and release administration', () => {
  let app: ReturnType<typeof createApp>;
  let appId: string;
  let releaseId: string;
  let csrfToken: string;
  let admin: ReturnType<typeof request.agent>;
  const content = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
const parseBinary = (response: IncomingMessage, callback: (error: Error | null, body?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', (error) => callback(error));
};

  beforeEach(async () => {
    await resetAndMigrateTestDatabase();
    await rm(storageDir, { recursive: true, force: true });
    await mkdir(storageDir, { recursive: true });
    const passwordHash = await hashPassword('Correct-Pass-123!');
    await testPool.query('INSERT INTO admin_users (username, password_hash) VALUES ($1,$2)', ['admin', passwordHash]);
    appId = (await testPool.query<{ id: string }>(
      'INSERT INTO apps (name, package_name) VALUES ($1,$2) RETURNING id', ['TubeLite', 'com.tubelite'],
    )).rows[0]!.id;
    releaseId = randomUUID();
    await testPool.query(
      `INSERT INTO releases (id, app_id, version_code, version_name, min_sdk, supported_abis, file_key,
        sha256, signing_cert_sha256, file_size_bytes) VALUES ($1,$2,3,'3.0',26,$3,$4,$5,$6,$7)`,
      [releaseId, appId, [], `${releaseId}.apk`, 'a'.repeat(64), 'b'.repeat(64), content.length],
    );
    await writeFile(path.join(storageDir, `${releaseId}.apk`), content);
    app = createApp({ pool: testPool, config });
    admin = request.agent(app);
    const login = await admin.post('/api/v1/admin/auth/login')
      .send({ username: 'admin', password: 'Correct-Pass-123!' }).expect(200);
    csrfToken = login.body.csrfToken;
  });

  afterAll(async () => { await rm(storageDir, { recursive: true, force: true }); await testPool.end(); });

  it('serves the immutable APK with correct headers and supports byte ranges', async () => {
    const full = await request(app).get(`/downloads/${releaseId}/app.apk`).buffer(true).parse(parseBinary).expect(200);
    expect(full.headers['content-type']).toContain('application/vnd.android.package-archive');
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.headers['content-length']).toBe(String(content.length));
    expect(full.body).toEqual(content);

    const partial = await request(app).get(`/downloads/${releaseId}/app.apk`).set('Range', 'bytes=2-5').buffer(true).parse(parseBinary).expect(206);
    expect(partial.headers['content-range']).toBe(`bytes 2-5/${content.length}`);
    expect(partial.body).toEqual(content.subarray(2, 6));

    const suffix = await request(app).get(`/downloads/${releaseId}/app.apk`).set('Range', 'bytes=-4').buffer(true).parse(parseBinary).expect(206);
    expect(suffix.body).toEqual(content.subarray(-4));
    await request(app).get(`/downloads/${releaseId}/app.apk`).set('Range', 'bytes=999-').expect(416)
      .expect('Content-Range', `bytes */${content.length}`);
  });

  it('lists releases, withdraws with CSRF, and blocks further public downloads', async () => {
    const history = await admin.get(`/api/v1/admin/apps/${appId}/releases`).expect(200);
    expect(history.body.releases).toHaveLength(1);
    expect(history.body.releases[0]).toMatchObject({ id: releaseId, versionCode: 3, status: 'published' });
    await admin.post(`/api/v1/admin/releases/${releaseId}/withdraw`).expect(403);
    await admin.post(`/api/v1/admin/releases/${releaseId}/withdraw`)
      .set('Origin', 'http://localhost:5173').set('X-CSRF-Token', csrfToken).expect(204);
    await request(app).get(`/downloads/${releaseId}/app.apk`).expect(404);
    expect((await admin.get(`/api/v1/admin/apps/${appId}/releases`).expect(200)).body.releases[0].status).toBe('withdrawn');
  });

  it('returns gone for a published release whose file is missing', async () => {
    const missingId = randomUUID();
    await testPool.query(
      `INSERT INTO releases (id, app_id, version_code, version_name, min_sdk, supported_abis, file_key,
        sha256, signing_cert_sha256, file_size_bytes) VALUES ($1,$2,4,'4.0',26,$3,$4,$5,$6,$7)`,
      [missingId, appId, [], `${missingId}.apk`, 'a'.repeat(64), 'b'.repeat(64), content.length],
    );
    await request(app).get(`/downloads/${missingId}/app.apk`).expect(410);
  });
});
