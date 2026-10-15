import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { readHiddenPassword } from './password-prompt.js';

describe('readHiddenPassword', () => {
  it('stops at Enter even when password and CRLF arrive in one input chunk', async () => {
    const input = Object.assign(new EventEmitter(), {
      isTTY: true,
      setRawMode: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn(),
    });
    const output = { write: vi.fn() };
    const password = 'duy123456789';
    const result = readHiddenPassword(input as never, output as never);

    input.emit('data', Buffer.from(`${password}\r\n`));
    input.emit('data', Buffer.from('\r'));

    await expect(result).resolves.toBe(password);
  });
});
