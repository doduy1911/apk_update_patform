import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Pool } from 'pg';
import type { AppConfig } from '../config.js';
import { requireAdmin, requireAdminToken, requireCsrf, requireSameOrigin } from '../auth/middleware.js';
import { PublishError, publishRelease } from './publish.js';
import type { ApkMetadata } from '../apk/inspect.js';

export function createReleasesRouter(
  pool: Pool,
  config: AppConfig,
  inspect?: (apkPath: string) => Promise<ApkMetadata>,
) {
  const router = Router();
  const stagingDir = path.join(config.apkStorageDir, '.staging');
  mkdirSync(stagingDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({ destination: stagingDir, filename: (_request, _file, callback) => callback(null, `${randomUUID()}.upload`) }),
    limits: { fileSize: config.maxApkBytes, files: 1, fields: 1, fieldSize: 16_000 },
  }).single('apk');
  const tokenAuth = requireAdminToken(pool);

  router.get('/:appId/releases', requireAdmin, async (request, response, next) => {
    const appId = request.params.appId;
    if (typeof appId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(appId)) {
      response.status(400).json({ error: { code: 'INVALID_APP_ID', message: 'Mã ứng dụng không hợp lệ.' } });
      return;
    }
    try {
      const appExists = await pool.query('SELECT 1 FROM apps WHERE id=$1', [appId]);
      if (appExists.rowCount === 0) {
        response.status(404).json({ error: { code: 'APP_NOT_FOUND', message: 'Ứng dụng không tồn tại.' } });
        return;
      }
      const { rows } = await pool.query(
        `SELECT id, app_id AS "appId", version_code AS "versionCode", version_name AS "versionName",
          release_notes AS "releaseNotes", min_sdk AS "minSdk", supported_abis AS "supportedAbis",
          sha256, signing_cert_sha256 AS "signingCertSha256", file_size_bytes AS "sizeBytes",
          status, created_at AS "createdAt"
         FROM releases WHERE app_id=$1 ORDER BY version_code DESC, created_at DESC`, [appId],
      );
      response.json({ releases: rows.map((release) => ({
        ...release,
        versionCode: Number(release.versionCode),
        sizeBytes: Number(release.sizeBytes),
        signingCertSha256: release.signingCertSha256.trim(),
        downloadUrl: `${config.publicBaseUrl}/downloads/${release.id}/app.apk`,
      })) });
    } catch (error) { next(error); }
  });

  router.post('/:appId/releases', (request: Request, response: Response, next: NextFunction) => {
    const bearer = request.get('authorization')?.startsWith('Bearer ') ?? false;
    if (bearer) return tokenAuth(request, response, next);
    requireAdmin(request, response, () => requireSameOrigin(config.adminOrigin)(request, response, (originError) => {
      if (originError) return next(originError);
      requireCsrf(request, response, next);
    }));
  }, (request, response, next) => {
    upload(request, response, (error) => {
      if (error) {
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
          response.status(413).json({ error: { code: 'APK_TOO_LARGE', message: 'APK vượt quá giới hạn dung lượng.' } });
          return;
        }
        if (error instanceof multer.MulterError) {
          response.status(400).json({ error: { code: 'INVALID_UPLOAD', message: 'Yêu cầu upload APK không hợp lệ.' } });
          return;
        }
        next(error);
        return;
      }
      next();
    });
  }, async (request, response, next) => {
    const file = request.file;
    if (!file) {
      response.status(400).json({ error: { code: 'APK_REQUIRED', message: 'Vui lòng gửi một file APK.' } });
      return;
    }
    const notes = request.body.releaseNotes;
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 4000)) {
      await rm(file.path, { force: true });
      response.status(400).json({ error: { code: 'INVALID_RELEASE_NOTES', message: 'Ghi chú phát hành tối đa 4000 ký tự.' } });
      return;
    }
    try {
      const appId = request.params.appId;
      if (typeof appId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(appId)) {
        await rm(file.path, { force: true });
        response.status(400).json({ error: { code: 'INVALID_APP_ID', message: 'Mã ứng dụng không hợp lệ.' } });
        return;
      }
      const result = await publishRelease(pool, config, appId, file.path, notes?.trim() || null, inspect);
      response.status(201).json(result);
    } catch (error) {
      if (error instanceof PublishError) {
        response.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      next(error);
    } finally {
      await rm(file.path, { force: true });
    }
  });
  return router;
}

export function createAdminReleasesRouter(pool: Pool, config: AppConfig) {
  const router = Router();
  router.post('/:releaseId/withdraw', requireAdmin, requireSameOrigin(config.adminOrigin), requireCsrf, async (request, response, next) => {
    const releaseId = request.params.releaseId;
    if (typeof releaseId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(releaseId)) {
      response.status(400).json({ error: { code: 'INVALID_RELEASE_ID', message: 'Mã bản phát hành không hợp lệ.' } });
      return;
    }
    try {
      const result = await pool.query("UPDATE releases SET status='withdrawn' WHERE id=$1 AND status='published' RETURNING id", [releaseId]);
      if (result.rowCount === 0) {
        const exists = await pool.query('SELECT 1 FROM releases WHERE id=$1', [releaseId]);
        if (exists.rowCount === 0) {
          response.status(404).json({ error: { code: 'RELEASE_NOT_FOUND', message: 'Bản phát hành không tồn tại.' } });
          return;
        }
      }
      response.status(204).end();
    } catch (error) { next(error); }
  });
  return router;
}
