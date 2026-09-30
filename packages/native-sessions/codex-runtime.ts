import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { AppError } from '../contracts/index.ts';
import { inspectCodexProtocol, nativeVersion } from './compatibility.ts';
const execute = promisify(execFile);

export async function findCodexBinary(launcher: string) {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new AppError('NATIVE_VERSION_UNSUPPORTED', 'Native terminal sharing currently requires Windows x64.', 409);
  const real = await fs.realpath(launcher), require = createRequire(real);
  const packageJson = require.resolve('@openai/codex-win32-x64/package.json');
  const metadata = JSON.parse(await fs.readFile(packageJson, 'utf8'));
  const installed = JSON.parse(await fs.readFile(path.join(path.dirname(real), '..', 'package.json'), 'utf8'));
  const alias = metadata.name === '@openai/codex' && installed.optionalDependencies?.['@openai/codex-win32-x64'] === 'npm:@openai/codex@' + metadata.version;
  if ((!alias && metadata.name !== '@openai/codex-win32-x64') || !metadata.os?.includes('win32') || !metadata.cpu?.includes('x64'))
    throw new AppError('NATIVE_SOURCE_MISMATCH', 'The installed native binary is not the official Codex Windows package.', 409);
  const binary = await fs.realpath(path.join(path.dirname(packageJson), 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'));
  return { binary, binaryHash: createHash('sha256').update(await fs.readFile(binary)).digest('hex') };
}

export async function findCodexLauncher(): Promise<string> {
  const candidates = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(directory =>
    path.join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
  for (const candidate of candidates) {
    try {
      const real = await fs.realpath(candidate);
      const metadata = JSON.parse(await fs.readFile(path.join(path.dirname(real), '..', 'package.json'), 'utf8'));
      if (metadata.name === '@openai/codex') return real;
    } catch { /* PATH candidates are not installed runtimes. */ }
  }
  throw new AppError('CODEX_NOT_FOUND', 'The installed official Codex npm launcher was not found on PATH.', 503);
}

export async function inspectCodexRuntime(launcher: string, evidenceRoot: string) {
  if (!path.isAbsolute(launcher) || path.basename(launcher) !== 'codex.js') throw new AppError('NATIVE_INVALID_INPUT', 'An absolute installed Codex launcher is required.');
  const real = await fs.realpath(launcher);
  const metadata = JSON.parse(await fs.readFile(path.join(path.dirname(real), '..', 'package.json'), 'utf8'));
  if (metadata.name !== '@openai/codex') throw new AppError('NATIVE_SOURCE_MISMATCH', 'The launcher is not from the official Codex package.');
  const versionOutput = await execute(process.execPath, [real, '--version'], { windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 });
  const version = nativeVersion('codex', versionOutput.stdout);
  const directory = await fs.mkdtemp(path.join(evidenceRoot, 'codex-compatibility-'));
  const schemaDirectory = path.join(directory, 'schema');
  await execute(process.execPath, [real, 'app-server', 'generate-json-schema', '--experimental', '--out', schemaDirectory], {
    cwd: directory, windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024,
  });
  const read = async (name: string) => {
    const file = path.join(schemaDirectory, name);
    if ((await fs.stat(file)).size > 32 * 1024 * 1024) throw new AppError('NATIVE_RPC_LIMIT', 'Generated protocol schema exceeds limits.');
    return JSON.parse(await fs.readFile(file, 'utf8'));
  };
  const protocol = inspectCodexProtocol({ requests: await read('ClientRequest.json'), notifications: await read('ServerNotification.json'),
    queueResponse: await read('v2/ThreadQueueAddResponse.json') });
  const launcherHash = createHash('sha256').update(await fs.readFile(real)).digest('hex');
  const report = { vendor: 'codex', version, launcher: real, launcherHash, protocol, functionalPassed: false, automaticUpgrade: false };
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  return { ...report, evidence: directory };
}
