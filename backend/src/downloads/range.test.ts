import { describe, expect, it } from 'vitest';
import { parseByteRange } from './range.js';

describe('parseByteRange', () => {
  it('parses closed, open-ended and suffix ranges and clamps end offsets', () => {
    expect(parseByteRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 });
    expect(parseByteRange('bytes=8-', 10)).toEqual({ start: 8, end: 9 });
    expect(parseByteRange('bytes=-4', 10)).toEqual({ start: 6, end: 9 });
    expect(parseByteRange('bytes=0-999', 10)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange(undefined, 10)).toBeNull();
  });

  it('rejects malformed, multiple, reversed, empty and out-of-file ranges', () => {
    for (const value of ['bytes=4-2', 'bytes=10-', 'bytes=-0', 'bytes=0-1,3-4', 'items=0-1', 'bytes=-']) {
      expect(parseByteRange(value, 10)).toBeUndefined();
    }
    expect(parseByteRange('bytes=0-', 0)).toBeUndefined();
  });
});
