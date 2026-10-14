import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import yauzl from 'yauzl';

const execFile = promisify(nodeExecFile);
const SHA256 = /^[a-f0-9]{64}$/i;

export type ApkMetadata = {
  packageName: string;
  versionCode: number;
  versionName: string;
  minSdk: number;
  supportedAbis: string[];
  signingCertSha256: string;
};

export function parseApkToolOutput(input: {
  applicationId: string; versionCode: string; versionName: string; minSdk: string;
  manifest: string; signer: string; abis: string[];
}): ApkMetadata {
  if (/<manifest\b[^>]*\bsplit\s*=/.test(input.manifest)) throw new Error('Split APKs are not supported');
  const versionCode = Number(input.versionCode.trim());
  const minSdk = Number(input.minSdk.trim());
  const fingerprints = [...input.signer.matchAll(/certificate SHA-256 digest:\s*([a-f0-9:]+)/gi)];
  if (fingerprints.length !== 1) throw new Error('APK must have exactly one signing certificate');
  const fingerprint = fingerprints[0]![1]!.replaceAll(':', '').toLowerCase();
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(input.applicationId.trim())) throw new Error('Invalid APK package name');
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || !Number.isSafeInteger(minSdk) || minSdk < 1) throw new Error('Invalid APK version or minSdk metadata');
  if (!input.versionName.trim() || input.versionName.length > 256) throw new Error('Invalid APK version name');
  if (!fingerprint || !SHA256.test(fingerprint)) throw new Error('APK signing certificate verification failed');
  return {
    packageName: input.applicationId.trim(), versionCode, versionName: input.versionName.trim(), minSdk,
    signingCertSha256: fingerprint,
    supportedAbis: [...new Set(input.abis)].sort(),
  };
}

function listAbis(apkPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(apkPath, { lazyEntries: true, autoClose: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(new Error('Invalid APK archive'));
      const abis = new Set<string>();
      let entries = 0;
      zip.on('error', () => reject(new Error('Invalid APK archive')));
      zip.on('entry', (entry) => {
        if (++entries > 100_000) { zip.close(); reject(new Error('APK has too many archive entries')); return; }
        const match = /^lib\/([^/]+)\/[^/]+\.so$/.exec(entry.fileName);
        if (match) abis.add(match[1]!);
        zip.readEntry();
      });
      zip.on('end', () => resolve([...abis].sort()));
      zip.readEntry();
    });
  });
}

export async function inspectApk(apkPath: string): Promise<ApkMetadata> {
  const run = async (command: string, args: string[]) => {
    try {
      const { stdout } = await execFile(command, args, { timeout: 20_000, maxBuffer: 1024 * 1024, windowsHide: true });
      return stdout.trim();
    } catch {
      throw new Error(`APK validation tool failed: ${command}`);
    }
  };
  const [applicationId, versionCode, versionName, minSdk, manifest, signer, abis] = await Promise.all([
    run('apkanalyzer', ['manifest', 'application-id', apkPath]),
    run('apkanalyzer', ['manifest', 'version-code', apkPath]),
    run('apkanalyzer', ['manifest', 'version-name', apkPath]),
    run('apkanalyzer', ['manifest', 'min-sdk', apkPath]),
    run('apkanalyzer', ['manifest', 'print', apkPath]),
    run('apksigner', ['verify', '--verbose', '--print-certs', apkPath]),
    listAbis(apkPath),
  ]);
  return parseApkToolOutput({ applicationId, versionCode, versionName, minSdk, manifest, signer, abis });
}
