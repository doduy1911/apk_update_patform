import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { z } from 'zod';
import type { Pool } from 'pg';
import type { AppConfig } from '../config.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { newCsrfToken, requireAdmin, requireCsrf, requireSameOrigin } from './middleware.js';

const PgSessionStore = connectPgSimple(session);
const loginSchema = z.object({ username: z.string().trim().min(1).max(120), password: z.string().min(1).max(1024) });

export function createAdminSessionMiddleware(pool: Pool, config: AppConfig) {
  const store = new PgSessionStore({
    pool,
    tableName: 'admin_sessions',
    createTableIfMissing: false,
    pruneSessionInterval: 15 * 60,
  });

  return session({
    name: 'apk_update_admin.sid',
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000,
      path: '/',
    },
  });
}

export function createAuthRouter(pool: Pool, config: AppConfig) {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'LOGIN_RATE_LIMITED', message: 'Thử đăng nhập lại sau ít phút.' } },
  });

  router.post('/login', loginLimiter, async (request, response, next) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Tên đăng nhập hoặc mật khẩu không hợp lệ.' } });
      return;
    }
    if (request.get('origin') && request.get('origin') !== config.adminOrigin) {
      response.status(403).json({ error: { code: 'ORIGIN_FORBIDDEN', message: 'Nguồn yêu cầu không hợp lệ.' } });
      return;
    }
    try {
      const username = parsed.data.username.toLowerCase();
      const { rows } = await pool.query<{ id: string; password_hash: string }>(
        'SELECT id, password_hash FROM admin_users WHERE username=$1', [username],
      );
      if (!await verifyPassword(rows[0]?.password_hash ?? null, parsed.data.password)) {
        response.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Tên đăng nhập hoặc mật khẩu không đúng.' } });
        return;
      }
      request.session.regenerate((error) => {
        if (error) return next(error);
        request.session.adminId = rows[0]!.id;
        request.session.csrfToken = newCsrfToken();
        request.session.save((saveError) => {
          if (saveError) return next(saveError);
          response.json({ admin: { username }, csrfToken: request.session.csrfToken });
        });
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/me', requireAdmin, async (request, response) => {
    const { rows } = await pool.query<{ username: string }>(
      'SELECT username FROM admin_users WHERE id=$1', [request.session.adminId],
    );
    if (!rows[0]) {
      response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Phiên quản trị đã hết hạn.' } });
      return;
    }
    response.json({ admin: { username: rows[0].username }, csrfToken: request.session.csrfToken });
  });

  router.post('/logout', requireAdmin, requireSameOrigin(config.adminOrigin), requireCsrf, (request, response, next) => {
    request.session.destroy((error) => {
      if (error) return next(error);
      response.clearCookie('apk_update_admin.sid', { httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'strict', path: '/' });
      response.status(204).end();
    });
  });

  return router;
}

export async function createAdmin(pool: Pool, username: string, password: string) {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalized)) throw new Error('Username must be 3-64 characters: letters, digits, dot, underscore or dash.');
  if (password.length < 12 || password.length > 1024) throw new Error('Password must contain 12-1024 characters.');
  const passwordHash = await hashPassword(password);
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO admin_users (username, password_hash) VALUES ($1, $2) RETURNING id',
    [normalized, passwordHash],
  );
  return rows[0]!.id;
}
