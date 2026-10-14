import { describe, expect, it } from 'vitest';
import { parseApkToolOutput } from './inspect.js';

describe('parseApkToolOutput', () => {
  it('maps Android tool output to normalized APK metadata', () => {
    const result = parseApkToolOutput({
      applicationId: 'com.example.app', versionCode: '12', versionName: '2.3', minSdk: '23',
      manifest: '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app"><application /></manifest>',
      signer: 'Signer #1 certificate SHA-256 digest: ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789',
      abis: ['arm64-v8a', 'armeabi-v7a'],
    });
    expect(result).toEqual({
      packageName: 'com.example.app', versionCode: 12, versionName: '2.3', minSdk: 23,
      signingCertSha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      supportedAbis: ['arm64-v8a', 'armeabi-v7a'],
    });
  });

  it('rejects split APKs, malformed metadata, and missing signer output', () => {
    const input = { applicationId: 'com.example.app', versionCode: '1', versionName: 'one', minSdk: '21',
      manifest: '<manifest split="config.arm64_v8a"/>', signer: '', abis: [] as string[] };
    expect(() => parseApkToolOutput(input)).toThrow(/split/i);
    expect(() => parseApkToolOutput({ ...input, manifest: '<manifest/>', signer: 'verify failed' })).toThrow(/sign/i);
    expect(() => parseApkToolOutput({ ...input, manifest: '<manifest/>', signer: 'Signer #1 certificate SHA-256 digest: ' + 'a'.repeat(64) + '\nSigner #2 certificate SHA-256 digest: ' + 'b'.repeat(64) })).toThrow(/one signing certificate/i);
    expect(() => parseApkToolOutput({ ...input, manifest: '<manifest/>', signer: 'SHA-256 digest: bad', versionCode: '0' })).toThrow();
  });
});
