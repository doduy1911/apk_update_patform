import { EventEmitter } from 'node:events';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { logApiStarted, requestLoggingMiddleware } from './request-logging.js';

describe('request logging', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs a health request once without its query string and returns the request ID', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const response = await request(createApp()).get('/health/live?token=do-not-log');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
    expect(log).toHaveBeenCalledTimes(1);
    const logLine = String(log.mock.calls[0]?.[0]);
    const entry = JSON.parse(logLine);
    expect(entry).toMatchObject({
      event: 'http_request',
      requestId: response.headers['x-request-id'],
      method: 'GET',
      path: '/health/live',
      statusCode: 200,
    });
    expect(entry.durationMs).toEqual(expect.any(Number));
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(logLine).not.toContain('do-not-log');
  });

  it('logs a 404 once and replaces a client supplied request ID', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const response = await request(createApp())
      .get('/missing')
      .set('X-Request-ID', 'client-value');

    expect(response.status).toBe(404);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
    expect(response.headers['x-request-id']).not.toBe('client-value');
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      event: 'http_request',
      requestId: response.headers['x-request-id'],
      method: 'GET',
      path: '/missing',
      statusCode: 404,
    });
  });

  it('logs the final 500 status when a request reaches the error handler', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const app = express();
    app.use(requestLoggingMiddleware);
    app.get('/failure', (_request, _response, next) => next(new Error('private error detail')));
    app.use((_error: unknown, _request: Request, response: Response, _next: express.NextFunction) => {
      response.status(500).json({ error: 'Internal server error' });
    });

    const response = await request(app).get('/failure?credential=hidden');

    expect(response.status).toBe(500);
    expect(log).toHaveBeenCalledTimes(1);
    const logLine = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(logLine)).toMatchObject({
      event: 'http_request',
      method: 'GET',
      path: '/failure',
      statusCode: 500,
    });
    expect(logLine).not.toContain('private error detail');
    expect(logLine).not.toContain('hidden');
  });

  it('logs a disconnect before headers once with a null status', () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = Object.assign(new EventEmitter(), {
      locals: {},
      headersSent: false,
      statusCode: 200,
      setHeader: vi.fn(),
    }) as unknown as Response;
    const req = { method: 'GET', path: '/downloads/release/app.apk' } as Request;

    requestLoggingMiddleware(req, response, () => undefined);
    response.emit('close');
    response.emit('finish');

    expect(response.setHeader).toHaveBeenCalledWith('X-Request-ID', response.locals.requestId);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      event: 'http_request',
      requestId: response.locals.requestId,
      method: 'GET',
      path: '/downloads/release/app.apk',
      statusCode: null,
    });
  });

  it('logs API startup as structured JSON without configuration secrets', () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logApiStarted(3000, 'development');

    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      event: 'api_started',
      port: 3000,
      environment: 'development',
    });
  });
});
