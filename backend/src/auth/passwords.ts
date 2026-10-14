import argon2 from 'argon2';

export function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string | null, password: string) {
  if (!hash) {
    await argon2.hash(password, { type: argon2.argon2id });
    return false;
  }
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
