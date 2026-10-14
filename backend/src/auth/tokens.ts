import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export async function createAdminToken(pool: Pool, adminUserId: string, name: string) {
  const value = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(value);
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO admin_api_tokens (admin_user_id, token_hash, name) VALUES ($1, $2, $3) RETURNING id',
    [adminUserId, tokenHash, name],
  );
  return { id: rows[0]!.id, value };
}

export async function getActiveAdminToken(pool: Pool, value: string) {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM admin_api_tokens WHERE token_hash=$1 AND revoked_at IS NULL',
    [hashToken(value)],
  );
  return rows[0]?.id ?? null;
}

export async function revokeAdminToken(pool: Pool, id: string) {
  const result = await pool.query(
    'UPDATE admin_api_tokens SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL', [id],
  );
  return result.rowCount === 1;
}
