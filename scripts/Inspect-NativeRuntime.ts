import fs from 'node:fs/promises';
import path from 'node:path';
import { findCodexLauncher, inspectCodexRuntime } from '../packages/native-sessions/codex-runtime.ts';
import { local } from '../apps/local-host/config.ts';
const evidence = path.join(local, 'verification'); await fs.mkdir(evidence, { recursive: true });
try {
  const report = await inspectCodexRuntime(process.argv[2] ?? await findCodexLauncher(), evidence, process.cwd());
  console.log(JSON.stringify(report));
  if (!report.protocol.compatibleShape) process.exitCode = 1;
} catch {
  console.error('Native runtime inspection failed; no runtime was upgraded and no model request was issued.');
  process.exitCode = 1;
}
