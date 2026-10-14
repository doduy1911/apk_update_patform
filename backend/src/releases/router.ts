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
