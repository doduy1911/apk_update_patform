import { Router } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import type { AppConfig } from '../config.js';
import { parseByteRange } from './range.js';

export function createDownloadsRouter(pool: Pool, config: AppConfig) {
  const router = Router();
  router.get('/:releaseId/app.apk', async (request, response, next) => {
    const releaseId = request.params.releaseId;
    if (typeof releaseId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(releaseId)) {
      response.status(404).json({ error: { code: 'RELEASE_NOT_FOUND', message: 'Bản phát hành không tồn tại.' } });
      return;
    }
    try {
      const { rows } = await pool.query<{ file_key: string; file_size_bytes: string; sha256: string }>(
        "SELECT file_key, file_size_bytes, sha256 FROM releases WHERE id=$1 AND status='published'", [releaseId],
      );
      const release = rows[0];
      if (!release) {
        response.status(404).json({ error: { code: 'RELEASE_NOT_FOUND', message: 'Bản phát hành không tồn tại.' } });
        return;
      }
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.apk$/i.test(release.file_key)) {
        response.status(410).json({ error: { code: 'RELEASE_FILE_MISSING', message: 'File APK không còn khả dụng.' } });
        return;
      }
      const filePath = path.join(config.apkStorageDir, release.file_key);
      let fileStat;
      try { fileStat = await stat(filePath); }
      catch (error) {
        if (isMissingFile(error)) {
          response.status(410).json({ error: { code: 'RELEASE_FILE_MISSING', message: 'File APK không còn khả dụng.' } });
          return;
        }
        throw error;
      }
      if (!fileStat.isFile() || fileStat.size !== Number(release.file_size_bytes)) {
        response.status(410).json({ error: { code: 'RELEASE_FILE_MISSING', message: 'File APK không còn khả dụng.' } });
        return;
      }
      const range = parseByteRange(request.get('range'), fileStat.size);
      if (range === undefined) {
        response.setHeader('Content-Range', `bytes */${fileStat.size}`);
        response.setHeader('Accept-Ranges', 'bytes');
        response.status(416).end();
        return;
      }
      response.setHeader('Content-Type', 'application/vnd.android.package-archive');
      response.setHeader('Content-Disposition', 'attachment; filename="application.apk"');
      response.setHeader('Accept-Ranges', 'bytes');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('ETag', `"${release.sha256.trim()}"`);
      const start = range?.start ?? 0;
      const end = range?.end ?? fileStat.size - 1;
      response.setHeader('Content-Length', String(end - start + 1));
      if (range) {
        response.setHeader('Content-Range', `bytes ${start}-${end}/${fileStat.size}`);
        response.status(206);
      }
      const stream = createReadStream(filePath, { start, end });
      stream.on('error', (error) => {
        if (response.headersSent) response.destroy(error);
        else next(error);
      });
      stream.pipe(response);
    } catch (error) { next(error); }
  });
  return router;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
