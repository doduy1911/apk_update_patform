import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { requireAdmin, requireCsrf, requireSameOrigin } from '../auth/middleware.js';
import type { AppConfig } from '../config.js';

const appSchema = z.object({
  name: z.string().trim().min(1).max(120),
  packageName: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/).max(255),
});

export function createAppsRouter(pool: Pool, config: AppConfig) {
  const router = Router();
  router.use(requireAdmin);
  router.get('/', async (_request, response, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, name, package_name AS "packageName", signing_cert_sha256 AS "signingCertSha256",
          created_at AS "createdAt" FROM apps ORDER BY created_at DESC, id`,
      );
      response.json({ apps: rows });
    } catch (error) { next(error); }
  });
  router.post('/', requireSameOrigin(config.adminOrigin), requireCsrf, async (request, response, next) => {
    const parsed = appSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'INVALID_APP', message: 'Tên hoặc package ứng dụng không hợp lệ.' } });
      return;
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO apps (name, package_name) VALUES ($1, $2)
         RETURNING id, name, package_name AS "packageName", signing_cert_sha256 AS "signingCertSha256", created_at AS "createdAt"`,
        [parsed.data.name, parsed.data.packageName],
      );
      response.status(201).json({ app: rows[0] });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        response.status(409).json({ error: { code: 'PACKAGE_ALREADY_REGISTERED', message: 'Package này đã được đăng ký.' } });
        return;
      }
      next(error);
    }
  });
  return router;
}
