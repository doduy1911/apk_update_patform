import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import type { AppConfig } from '../config.js';

const supportedAbi = z.string().regex(/^[A-Za-z0-9_-]+$/).max(40);
const checkSchema = z.object({
  packageName: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/).max(255),
  currentVersionCode: z.number().int().min(0).max(2_147_483_647),
  sdkInt: z.number().int().min(1).max(1000),
  supportedAbis: z.array(supportedAbi).max(4),
}).strict();

type Candidate = {
  id: string; version_code: string; version_name: string; release_notes: string | null;
  min_sdk: number; supported_abis: string[]; sha256: string; signing_cert_sha256: string;
  file_size_bytes: string;
};

export function createUpdatesRouter(pool: Pool, config: AppConfig) {
  const router = Router();
  router.post('/check', async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const parsed = checkSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Thông tin phiên bản hoặc thiết bị không hợp lệ.' } });
      return;
    }
    try {
      const appResult = await pool.query<{ id: string; package_name: string }>(
        'SELECT id, package_name FROM apps WHERE package_name=$1', [parsed.data.packageName],
      );
      const registeredApp = appResult.rows[0];
      if (!registeredApp) {
        response.status(404).json({ error: { code: 'APP_NOT_FOUND', message: 'Ứng dụng chưa được đăng ký.' } });
        return;
      }
      const { rows } = await pool.query<Candidate>(
        `SELECT id, version_code, version_name, release_notes, min_sdk, supported_abis,
          sha256, signing_cert_sha256, file_size_bytes
         FROM releases WHERE app_id=$1 AND status='published' AND version_code > $2
         ORDER BY version_code DESC`,
        [registeredApp.id, parsed.data.currentVersionCode],
      );
      if (rows.length === 0) {
        response.json({ updateAvailable: false, release: null, reason: 'UP_TO_DATE' });
        return;
      }
      const deviceAbis = new Set<string>(parsed.data.supportedAbis);
      const selected = rows.find((release) => release.min_sdk <= parsed.data.sdkInt
        && (release.supported_abis.length === 0 || release.supported_abis.some((abi) => deviceAbis.has(abi))));
      if (!selected) {
        response.json({ updateAvailable: false, release: null, reason: 'NO_COMPATIBLE_RELEASE' });
        return;
      }
      response.json({
        updateAvailable: true,
        release: {
          id: selected.id,
          packageName: registeredApp.package_name,
          versionCode: Number(selected.version_code),
          versionName: selected.version_name,
          releaseNotes: selected.release_notes,
          downloadUrl: `${config.publicBaseUrl}/downloads/${selected.id}/app.apk`,
          sizeBytes: Number(selected.file_size_bytes),
          sha256: selected.sha256.trim(),
          signingCertSha256: selected.signing_cert_sha256.trim(),
        },
      });
    } catch (error) { next(error); }
  });
  return router;
}
