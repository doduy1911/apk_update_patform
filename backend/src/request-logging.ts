import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export function logApiStarted(port: number, environment: string) {
  console.info(JSON.stringify({ event: 'api_started', port, environment }));
}

export const requestLoggingMiddleware: RequestHandler = (request, response, next) => {
  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();
  let logged = false;

  response.locals.requestId = requestId;
  response.setHeader('X-Request-ID', requestId);

  const writeLog = () => {
    if (logged) return;
    logged = true;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    console.info(JSON.stringify({
      event: 'http_request',
      requestId,
      method: request.method,
      path: request.path,
      statusCode: response.headersSent ? response.statusCode : null,
      durationMs,
    }));
  };

  response.once('finish', writeLog);
  response.once('close', writeLog);
  next();
};
