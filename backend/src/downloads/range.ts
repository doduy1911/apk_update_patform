export type ByteRange = { start: number; end: number };

export function parseByteRange(value: string | undefined, size: number): ByteRange | null | undefined {
  if (!value) return null;
  if (!Number.isSafeInteger(size) || size <= 0) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return undefined;
  const startText = match[1]!;
  const endText = match[2]!;
  let start: number;
  let end: number;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return undefined;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return undefined;
    end = Math.min(end, size - 1);
  }
  if (start >= size || start > end) return undefined;
  return { start, end };
}
