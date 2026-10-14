import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('createApp', () => {
  it('exposes liveness without requiring a database connection', async () => {
    const response = await request(createApp()).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const response = await request(createApp()).get('/missing');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });
});
