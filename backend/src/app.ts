import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type { Pool } from 'pg';
import { checkDatabaseReadiness } from './db/readiness.js';

export function createApp(dependencies: { pool?: Pool } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
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
  app.use((_request, response) => response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } }));
  const errors: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    console.error('Unhandled request error', error);
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  };
  app.use(errors);
  return app;
}
