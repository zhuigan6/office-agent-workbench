import { open } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ClientError, type Transport } from '../../packages/client/index.ts';
import { ScopedClient, inputLimit, parseInput, toolRoutes, validateConnection, type ToolCommand } from '../../packages/client/scoped.ts';
import { readStdin, redact } from './commands.ts';

export const usage = `Scoped document tools (JSON output):
  node --import tsx apps/cli/scoped.ts <command> [--json <object> | -]
Commands: ${Object.keys(toolRoutes).join(', ')}
Omitted input or '-' reads a JSON object from stdin; capabilities defaults to {}.
Required environment: WORKBENCH_URL, WORKBENCH_TOOL_TOKEN, WORKBENCH_CA.
No admin/config routes, credential export, shell execution or automatic retries.`;

export function parseArgs(argv: string[]): { command: ToolCommand; json?: string } | { command: 'help' } {
  const [command, ...args] = argv;
  if ((!command || command === '--help' || command === 'help') && !args.length) return { command: 'help' };
  if (!Object.hasOwn(toolRoutes, command ?? '') ||
      !(args.length === 0 || (args.length === 1 && args[0] === '-') ||
        (args.length === 2 && args[0] === '--json'))) {
    throw new ClientError('ARGUMENT', 'Invalid command arguments. Use --help.');
  }
  return { command: command as ToolCommand,
    json: args.length === 2 ? args[1] : command === 'capabilities' && !args.length ? '{}' : undefined };
}

export async function loadCa(filename: string | undefined): Promise<string> {
  try {
    if (!filename || !path.isAbsolute(filename)) throw new Error();
    const handle = await open(filename, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 64 * 1024) throw new Error();
      const bytes = Buffer.alloc(64 * 1024 + 1);
      let size = 0;
      while (size < bytes.length) {
        const { bytesRead } = await handle.read(bytes, size, bytes.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > 64 * 1024) throw new Error();
      return new X509Certificate(bytes.subarray(0, size)).toString();
    } finally { await handle.close(); }
  } catch { throw new ClientError('CONFIG', 'Cannot read the explicit trusted certificate.'); }
}

export async function main(argv = process.argv.slice(2), options: {
  env?: NodeJS.ProcessEnv; input?: AsyncIterable<Buffer | string>; isTTY?: boolean;
  stdout?: (text: string) => void; stderr?: (text: string) => void; transport?: Transport;
} = {}): Promise<number> {
  const env = options.env ?? process.env;
  const secrets = [env.WORKBENCH_TOOL_TOKEN ?? ''];
  const stdout = options.stdout ?? (text => { process.stdout.write(text); });
  const stderr = options.stderr ?? (text => { process.stderr.write(text); });
  const encode = (value: unknown) => JSON.stringify(redact(value, secrets)) + '\n';
  try {
    const parsed = parseArgs(argv);
    if (parsed.command === 'help') { stdout(encode({ usage })); return 0; }
    const url = validateConnection(env.WORKBENCH_URL, env.WORKBENCH_TOOL_TOKEN);
    let json = parsed.json;
    if (json === undefined) {
      if (options.isTTY ?? process.stdin.isTTY) throw new ClientError('STDIN', 'Pipe a JSON object or use --json.');
      json = await readStdin(options.input ?? process.stdin, inputLimit);
    }
    const data = parseInput(json);
    const ca = await loadCa(env.WORKBENCH_CA);
    const client = new ScopedClient({ url, token: env.WORKBENCH_TOOL_TOKEN!, ca, transport: options.transport });
    stdout(encode(await client.invoke(parsed.command, data)));
    return 0;
  } catch (error) {
    const safe = error instanceof ClientError ? { code: error.code, message: error.message }
      : { code: 'FAILED', message: 'Command failed; internal details suppressed.' };
    stderr(encode({ error: safe }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
