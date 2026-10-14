import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.get('/health/live', (_request, response) => response.json({ status: 'ok' }));
  app.use((_request, response) => response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } }));
  const errors: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    console.error('Unhandled request error', error);
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  };
  app.use(errors);
  return app;
}
