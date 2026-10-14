import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), 'Must be a PostgreSQL URL'),
  SESSION_SECRET: z.string().min(32),
  PUBLIC_BASE_URL: z.string().url(),
  APK_STORAGE_DIR: z.string().min(1),
  MAX_APK_BYTES: z.coerce.number().int().positive().default(536870912),
  ADMIN_ORIGIN: z.string().url(),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  publicBaseUrl: string;
  apkStorageDir: string;
  maxApkBytes: number;
  adminOrigin: string;
};

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const variables = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? 'environment')))];
    throw new Error(`Invalid environment configuration: ${variables.join(', ')}`);
  }
  return {
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    sessionSecret: parsed.data.SESSION_SECRET,
    publicBaseUrl: parsed.data.PUBLIC_BASE_URL.replace(/\/$/, ''),
    apkStorageDir: parsed.data.APK_STORAGE_DIR,
    maxApkBytes: parsed.data.MAX_APK_BYTES,
    adminOrigin: parsed.data.ADMIN_ORIGIN,
  };
}
