import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import type { AppConfig } from '../config.js';
import { inspectApk, type ApkMetadata } from '../apk/inspect.js';

export class PublishError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}

async function sha256File(filePath: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function publishRelease(
  pool: Pool,
  config: AppConfig,
  appId: string,
  tempPath: string,
  releaseNotes: string | null,
  inspect: (path: string) => Promise<ApkMetadata> = inspectApk,
) {
  const fileStat = await stat(tempPath);
  if (fileStat.size < 1 || fileStat.size > config.maxApkBytes) throw new PublishError('APK_SIZE_INVALID', 413, 'Kích thước APK không hợp lệ.');
  let metadata: ApkMetadata;
  try { metadata = await inspect(tempPath); }
  catch { throw new PublishError('APK_INVALID', 422, 'Không thể xác minh APK hoặc chữ ký APK không hợp lệ.'); }
  const sha256 = await sha256File(tempPath);
  const id = randomUUID();
  const fileKey = `${id}.apk`;
  await mkdir(config.apkStorageDir, { recursive: true });
  const finalPath = path.join(config.apkStorageDir, fileKey);
  const client = await pool.connect();
  let moved = false;
  let transactionOpen = false;
  let commitAttempted = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const appResult = await client.query<{ package_name: string; signing_cert_sha256: string | null }>(
      'SELECT package_name, signing_cert_sha256 FROM apps WHERE id=$1 FOR UPDATE', [appId],
    );
    const app = appResult.rows[0];
    if (!app) throw new PublishError('APP_NOT_FOUND', 404, 'Ứng dụng không tồn tại.');
    if (app.package_name !== metadata.packageName) throw new PublishError('PACKAGE_MISMATCH', 422, 'Package trong APK không khớp ứng dụng đã chọn.');
    if (app.signing_cert_sha256 && app.signing_cert_sha256.trim() !== metadata.signingCertSha256) {
      throw new PublishError('SIGNING_CERT_MISMATCH', 422, 'Chứng thư ký APK không khớp ứng dụng đã đăng ký.');
    }
    await rename(tempPath, finalPath);
    moved = true;
    await client.query(
      'UPDATE apps SET signing_cert_sha256=COALESCE(signing_cert_sha256, $2), updated_at=now() WHERE id=$1',
      [appId, metadata.signingCertSha256],
    );
    const { rows } = await client.query(
      `INSERT INTO releases
        (id, app_id, version_code, version_name, release_notes, min_sdk, supported_abis, file_key, sha256, signing_cert_sha256, file_size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, app_id AS "appId", version_code AS "versionCode", version_name AS "versionName",
        release_notes AS "releaseNotes", min_sdk AS "minSdk", supported_abis AS "supportedAbis",
        sha256, signing_cert_sha256 AS "signingCertSha256", file_size_bytes AS "sizeBytes", status, created_at AS "createdAt"`,
      [id, appId, metadata.versionCode, metadata.versionName, releaseNotes, metadata.minSdk,
        metadata.supportedAbis, fileKey, sha256, metadata.signingCertSha256, fileStat.size],
    );
    commitAttempted = true;
    await client.query('COMMIT');
    transactionOpen = false;
    const release = rows[0];
    return {
      release: { ...release, packageName: app.package_name, versionCode: Number(release.versionCode), sizeBytes: Number(release.sizeBytes) },
      downloadUrl: `${config.publicBaseUrl}/downloads/${id}/app.apk`,
    };
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); transactionOpen = false; } catch { /* Preserve original error; transaction outcome may be unknown. */ }
    }
    if (moved && !commitAttempted) await rm(finalPath, { force: true });
    if (error instanceof PublishError) throw error;
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new PublishError('VERSION_ALREADY_PUBLISHED', 409, 'Version code này đã được phát hành cho ứng dụng.');
    }
    throw error;
  } finally {
    client.release();
    await rm(tempPath, { force: true });
  }
}
