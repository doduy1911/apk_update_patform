import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPool } from './pool.js';

describe('createPool', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs idle PostgreSQL client errors without crashing the process', async () => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pool = createPool({ databaseUrl: 'postgres://test:test@localhost:5432/test_db' });
    const error = Object.assign(new Error('connection terminated'), { code: '57P01' });

    expect(() => pool.emit('error', error, {} as never)).not.toThrow();
    expect(logger).toHaveBeenCalledWith('Unexpected PostgreSQL pool client error', { code: '57P01' });

    await pool.end();
  });
});
