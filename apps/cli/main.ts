import { readFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, local } from '../local-host/config.ts';
import { ClientError, WorkbenchClient } from '../../packages/client/index.ts';
import { execute, parseArgs, readStdin, redact, usage } from './commands.ts';

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let secrets: string[] = [];
  try {
    const command = parseArgs(argv);
    if (command.kind === 'help') { process.stdout.write(JSON.stringify({ usage }) + '\n'); return 0; }
    let client: WorkbenchClient;
    try {
      const config = loadConfig();
      secrets = [config.uiToken, config.coreSecret, config.pfxPassword];
      const ca = new X509Certificate(await readFile(path.join(local, 'server.cer'))).toString();
      client = new WorkbenchClient({ port: config.port, token: config.uiToken, ca });
    } catch { throw new ClientError('CONFIG', 'Cannot load local Workbench configuration and trusted certificate.'); }
    const result = await execute(command, client, async () => {
      if (process.stdin.isTTY) throw new ClientError('STDIN', 'Provide a message argument or pipe UTF-8 input.');
      return readStdin(process.stdin);
    });
    process.stdout.write(JSON.stringify(redact(result, secrets)) + '\n');
    return 0;
  } catch (error) {
    const safe = error instanceof ClientError ? { code: error.code, message: error.message }
      : { code: 'FAILED', message: 'Command failed; internal details suppressed.' };
    process.stderr.write(JSON.stringify({ error: redact(safe, secrets) }) + '\n');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
