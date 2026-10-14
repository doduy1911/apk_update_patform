import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { hashPassword, verifyPassword } from '../../src/auth/passwords.js';
import { createAdmin } from '../../src/auth/router.js';
import { createAdminToken, getActiveAdminToken, revokeAdminToken } from '../../src/auth/tokens.js';
import { loadConfig } from '../../src/config.js';
import { resetAndMigrateTestDatabase, testPool } from './test-db.js';

const config = loadConfig({
  NODE_ENV: 'test', PORT: '3000', DATABASE_URL: 'postgres://test:test@localhost:5432/test_db',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough', PUBLIC_BASE_URL: 'https://updates.example.test',
  APK_STORAGE_DIR: '/tmp/apk-update-test', MAX_APK_BYTES: '536870912', ADMIN_ORIGIN: 'http://localhost:5173',
});

describe('admin authentication and app registry', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    await resetAndMigrateTestDatabase();
    const passwordHash = await hashPassword('Correct-Pass-123!');
    await testPool.query('INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)', ['admin', passwordHash]);
    app = createApp({ pool: testPool, config });
  });

  afterAll(async () => { await testPool.end(); });

  it('rejects unauthenticated admin requests and invalid credentials', async () => {
    await request(app).get('/api/v1/admin/auth/me').expect(401);
    await request(app).post('/api/v1/admin/auth/login').send({ username: 'admin', password: 'wrong' }).expect(401);
  });

  it('expires a session when its database expiry is in the past', async () => {
    const admin = request.agent(app);
    await admin.post('/api/v1/admin/auth/login')
      .send({ username: 'admin', password: 'Correct-Pass-123!' }).expect(200);
    await testPool.query("UPDATE admin_sessions SET expire=now() - interval '1 minute'");
    await admin.get('/api/v1/admin/auth/me').expect(401);
  });

  it('limits repeated failed login attempts', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(app).post('/api/v1/admin/auth/login')
        .send({ username: 'admin', password: 'incorrect' }).expect(401);
    }
    await request(app).post('/api/v1/admin/auth/login')
      .send({ username: 'admin', password: 'incorrect' }).expect(429);
  });

  it('creates a session, returns a CSRF token, and requires it for app changes', async () => {
    const admin = request.agent(app);
    const login = await admin.post('/api/v1/admin/auth/login')
      .send({ username: 'admin', password: 'Correct-Pass-123!' }).expect(200);
    expect(login.body.csrfToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(login.headers['set-cookie']?.[0]).toContain('HttpOnly');
    await admin.get('/api/v1/admin/auth/me').expect('Cache-Control', 'no-store').expect(200);
    await admin.post('/api/v1/admin/apps').send({ name: 'TubeLite', packageName: 'com.tubelite' }).expect(403);

    const created = await admin.post('/api/v1/admin/apps')
      .set('Origin', config.adminOrigin)
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({ name: 'TubeLite', packageName: 'com.tubelite' }).expect(201);
    expect(created.body.app.packageName).toBe('com.tubelite');
    expect((await admin.get('/api/v1/admin/apps')).body.apps).toHaveLength(1);
    await admin.post('/api/v1/admin/auth/logout')
      .set('Origin', config.adminOrigin)
      .set('X-CSRF-Token', login.body.csrfToken).expect(204);
    await admin.get('/api/v1/admin/auth/me').expect(401);
  });

  it('rejects a package name already registered to another app', async () => {
    const admin = request.agent(app);
    const login = await admin.post('/api/v1/admin/auth/login')
      .send({ username: 'admin', password: 'Correct-Pass-123!' }).expect(200);
    const create = (name: string) => admin.post('/api/v1/admin/apps')
      .set('Origin', config.adminOrigin).set('X-CSRF-Token', login.body.csrfToken)
      .send({ name, packageName: 'com.tubelite' });
    await create('TubeLite').expect(201);
    await create('Duplicate').expect(409);
    await admin.post('/api/v1/admin/apps')
      .set('Origin', config.adminOrigin).set('X-CSRF-Token', login.body.csrfToken)
      .send({ name: 'Bad', packageName: 'not a package' }).expect(400);
  });

  it('stops accepting a revoked upload token', async () => {
    const user = await testPool.query<{ id: string }>('SELECT id FROM admin_users WHERE username=$1', ['admin']);
    const token = await createAdminToken(testPool, user.rows[0]!.id, 'build pipeline');
    expect(await getActiveAdminToken(testPool, token.value)).toBe(token.id);
    await revokeAdminToken(testPool, token.id);
    expect(await getActiveAdminToken(testPool, token.value)).toBeNull();
  });

  it('creates an admin with a password hash and rejects weak credentials', async () => {
    const id = await createAdmin(testPool, 'Build.Ops', 'Another-Strong-Pass-123!');
    const { rows } = await testPool.query<{ username: string; password_hash: string }>(
      'SELECT username, password_hash FROM admin_users WHERE id=$1', [id],
    );
    expect(rows[0]?.username).toBe('build.ops');
    expect(rows[0]?.password_hash).not.toBe('Another-Strong-Pass-123!');
    expect(await verifyPassword(rows[0]!.password_hash, 'Another-Strong-Pass-123!')).toBe(true);
    await expect(createAdmin(testPool, 'X', 'weak')).rejects.toThrow(/Username/);
  });
});
