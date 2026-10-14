import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import type { Pool } from 'pg';
import type { AppConfig } from './config.js';
import { checkDatabaseReadiness } from './db/readiness.js';
import { createAdminSessionMiddleware, createAuthRouter } from './auth/router.js';
import { createAppsRouter } from './apps/router.js';
import { createAdminReleasesRouter, createReleasesRouter } from './releases/router.js';
import type { ApkMetadata } from './apk/inspect.js';
import { createUpdatesRouter } from './updates/router.js';
import { createDownloadsRouter } from './downloads/router.js';

export function createApp(dependencies: { pool?: Pool; config?: AppConfig; inspectApk?: (path: string) => Promise<ApkMetadata> } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (dependencies.config?.nodeEnv === 'production') app.set('trust proxy', 1);
  app.use(helmet());
  if (dependencies.config) {
    app.use(cors({
      origin: dependencies.config.adminOrigin,
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Authorization'],
      methods: ['GET', 'POST', 'OPTIONS'],
    }));
  }
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/v1/admin', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.get('/health/live', (_request, response) => response.json({ status: 'ok' }));
  app.get('/health/ready', async (_request, response) => {
    if (!dependencies.pool) return response.status(503).json({ status: 'not_ready', database: 'unavailable' });
    try {
      const ready = await checkDatabaseReadiness(dependencies.pool);
      return response.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'not_ready',
        database: ready ? 'ready' : 'schema_missing',
      });
    } catch {
      return response.status(503).json({ status: 'not_ready', database: 'unavailable' });
    }
  });
  if (dependencies.pool && dependencies.config) {
    app.use('/api/v1/admin', createAdminSessionMiddleware(dependencies.pool, dependencies.config));
    app.use('/api/v1/admin/auth', createAuthRouter(dependencies.pool, dependencies.config));
    app.use('/api/v1/admin/apps', createAppsRouter(dependencies.pool, dependencies.config));
    app.use('/api/v1/admin/apps', createReleasesRouter(dependencies.pool, dependencies.config, dependencies.inspectApk));
    app.use('/api/v1/admin/releases', createAdminReleasesRouter(dependencies.pool, dependencies.config));
    app.use('/api/v1/updates', createUpdatesRouter(dependencies.pool, dependencies.config));
    app.use('/downloads', createDownloadsRouter(dependencies.pool, dependencies.config));
  }
  app.use((_request, response) => response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } }));
  const errors: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    console.error('Unhandled request error', error);
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  };
  app.use(errors);
  return app;
}
