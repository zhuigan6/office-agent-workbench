import { open, lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ClientError, WorkbenchClient } from '../../packages/client/index.ts';

export const usage = `Commands:
  status
  conversations
  archives
  archive <sha256> [--offset <number>]
  import-history <path>
  messages <id> [--before <cursor>]
  send <id> [message | -] [--file <fileId>]... [--request-id <id>] [-- <literal message>]
  files [conversation]
  upload <path> [conversation]
  file                         JSON object on stdin
  mcp-config <conversation> <outputPath>
  native-sessions
  native-events <linkId> [--after <sequence>]
  native-receipts <linkId> [--after <cursor>]
  native-send <linkId> [message | -] --request-id <stableId>
  native-close <linkId>
Omitted send message or '-' reads UTF-8 stdin. No conversations are created.`;

export type Command =
  | { kind: 'help' | 'status' | 'conversations' | 'archives' | 'native-sessions' }
  | { kind: 'native-events' | 'native-receipts'; id: string; after: number }
  | { kind: 'native-send'; id: string; message?: string; requestId: string }
  | { kind: 'native-close'; id: string }
  | { kind: 'archive'; id:string; offset:number }
  | { kind: 'import-history'; filename:string }
  | { kind: 'messages'; id: string; before?: string }
  | { kind: 'send'; id: string; message?: string; files: string[]; requestId?:string }
  | { kind: 'files'; conversation?: string }
  | { kind: 'upload'; filename: string; conversation?: string }
  | { kind: 'file' }
  | { kind: 'mcp-config'; id: string; filename: string };

function argument(): never { throw new ClientError('ARGUMENT', 'Invalid command arguments. Use --help.'); }
function id(value: string | undefined): string {
  if (!value || !/^[\w-]+$/.test(value)) argument();
  return value;
}
export function parseArgs(argv: string[]): Command {
  const [kind, ...args] = argv;
  if (kind === '--help' || kind === 'help' || !kind) { if (args.length) argument(); return { kind: 'help' }; }
  if (kind === 'status' || kind === 'conversations' || kind === 'file' || kind==='archives' || kind==='native-sessions') {
    if (args.length) argument(); return { kind };
  }
  if (kind === 'native-events' || kind === 'native-receipts' || kind === 'native-close' || kind === 'native-send') {
    if (!/^[a-f0-9-]{36}$/.test(args[0] ?? '')) argument();
    if (kind === 'native-close') { if (args.length !== 1) argument(); return { kind, id: args[0] }; }
    if (kind === 'native-send') {
      const parsed = parseArgs(['send', ...args]);
      if (parsed.kind !== 'send' || parsed.files.length || !parsed.requestId) argument();
      return { kind, id: parsed.id, message: parsed.message, requestId: parsed.requestId };
    }
    if (args.length !== 1 && (args.length !== 3 || args[1] !== '--after' || !/^\d+$/.test(args[2]))) argument();
    const after = Number(args[2] ?? '0'); if (!Number.isSafeInteger(after)) argument();
    return { kind, id: args[0], after };
  }
  if(kind==='archive'){
    if(!/^[a-f0-9]{64}$/.test(args[0]||'')||(args.length!==1&&(args.length!==3||args[1]!=='--offset'||!/^\d+$/.test(args[2]))))argument();
    const offset=Number(args[2]||0);if(!Number.isSafeInteger(offset))argument();return {kind,id:args[0],offset};
  }
  if(kind==='import-history'){if(args.length!==1||!args[0])argument();return {kind,filename:args[0]};}
  if (kind === 'messages') {
    if (args.length !== 1 && (args.length !== 3 || args[1] !== '--before' || !args[2] || args[2].length > 1000)) argument();
    return { kind, id: id(args[0]), before: args[2] };
  }
  if (kind === 'send') {
    const conversation = id(args.shift());
    let message: string | undefined;
    let requestId:string|undefined;
    const files: string[] = [];
    while (args.length) {
      const next = args.shift()!;
      if (next === '--file') { files.push(id(args.shift())); continue; }
      if(next==='--request-id'){if(requestId!==undefined)argument();requestId=args.shift();if(!requestId||! /^[\w-]{8,128}$/.test(requestId))argument();continue;}
      if (next === '--') {
        if (message !== undefined || args.length !== 1) argument();
        message = args.shift()!; break;
      }
      if (message !== undefined || (next.startsWith('-') && next !== '-')) argument();
      message = next;
    }
    if (files.length > 10) argument();
    return { kind, id: conversation, message: message === '-' ? undefined : message, files,...(requestId?{requestId}:{}) };
  }
  if (kind === 'files') {
    if (args.length > 1) argument();
    return { kind, conversation: args.length ? id(args[0]) : undefined };
  }
  if (kind === 'upload' || kind === 'mcp-config') {
    if (args.length < 1 || args.length > 2 || !args[0] || (kind === 'mcp-config' && !args[1])) argument();
    return kind === 'upload' ? { kind, filename: args[0], conversation: args.length === 2 ? id(args[1]) : undefined }
      : { kind, id: id(args[0]), filename: args[1] };
  }
  return argument();
}

export async function readStdin(input: AsyncIterable<Buffer | string>, limit = 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    size += bytes.length;
    if (size > limit) throw new ClientError('INPUT_LIMIT', 'Standard input exceeds the client limit.');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateMcpConfig(value: unknown, origin: string): unknown {
  const invalid = () => new ClientError('INVALID_ACCESS', 'Workbench returned an invalid scoped MCP configuration.');
  if (!object(value) || !object(value.mcpServers)) throw invalid();
  const server = value.mcpServers['office-workbench'];
  if (!object(server) || typeof server.command !== 'string' || !path.isAbsolute(server.command) ||
      !Array.isArray(server.args) || server.args.length !== 3 || server.args[0] !== '--import' ||
      typeof server.args[1] !== 'string' || !server.args[1].startsWith('file:///') ||
      typeof server.args[2] !== 'string' || !path.isAbsolute(server.args[2]) || !object(server.env)) throw invalid();
  const env = server.env;
  if (env.WORKBENCH_URL !== origin || typeof env.WORKBENCH_TOOL_TOKEN !== 'string' || !env.WORKBENCH_TOOL_TOKEN ||
      typeof env.WORKBENCH_CA !== 'string' || !path.isAbsolute(env.WORKBENCH_CA)) throw invalid();
  // Export only the agreed scoped fields, never unrelated server environment/settings.
  return { mcpServers: { 'office-workbench': { command: server.command, args: server.args,
    env: { WORKBENCH_URL: env.WORKBENCH_URL, WORKBENCH_TOOL_TOKEN: env.WORKBENCH_TOOL_TOKEN, WORKBENCH_CA: env.WORKBENCH_CA } } } };
}

export async function exportMcp(client: WorkbenchClient, conversation: string, filename: string): Promise<unknown> {
  const outputPath = path.resolve(filename);
  const exists = await lstat(outputPath).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw new ClientError('EXPORT', 'Cannot inspect output path.');
    return false;
  });
  if (exists) throw new ClientError('EXISTS', 'Output already exists; choose a new path.');
  const config = validateMcpConfig(await client.access(conversation), client.origin);
  try { await writeFile(outputPath, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch { throw new ClientError('EXPORT', 'Cannot create MCP configuration; existing files are never overwritten.'); }
  return { written: true, outputPath };
}

export async function execute(command: Command, client: WorkbenchClient, stdin: () => Promise<string>): Promise<unknown> {
  switch (command.kind) {
    case 'help': return { usage };
    case 'status': return client.status();
    case 'conversations': return client.conversations();
    case 'native-sessions': return client.nativeSessions();
    case 'native-events': return client.nativeEvents(command.id, command.after);
    case 'native-receipts': return client.nativeReceipts(command.id, command.after);
    case 'native-send': return client.nativeSend(command.id, command.message ?? await stdin(), command.requestId);
    case 'native-close': return client.nativeClose(command.id);
    case 'archives': return client.archives();
    case 'archive': return client.archive(command.id,command.offset);
    case 'import-history': {
      let bytes:Buffer;
      try{const handle=await open(command.filename,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.size>8*1024*1024)throw Error();bytes=await readFile(handle);}finally{await handle.close();}}
      catch{throw new ClientError('UPLOAD','Cannot read a regular history file of at most 8 MiB.');}
      return client.importArchive(path.basename(command.filename),bytes);
    }
    case 'messages': return client.messages(command.id, command.before);
    case 'send': return client.send(command.id, command.message ?? await stdin(), command.files,command.requestId);
    case 'files': return client.files(command.conversation);
    case 'upload': {
      let bytes: Buffer;
      try {
        const handle = await open(command.filename, 'r');
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error();
          bytes = await readFile(handle);
        } finally { await handle.close(); }
      } catch { throw new ClientError('UPLOAD', 'Cannot read a regular upload file of at most 32 MiB.'); }
      return client.upload(path.basename(command.filename), bytes, command.conversation);
    }
    case 'file': {
      let data: unknown;
      const text = await stdin();
      try { data = JSON.parse(text); } catch { throw new ClientError('INPUT_JSON', 'Standard input must be a JSON object.'); }
      if (!object(data)) throw new ClientError('INPUT_JSON', 'Standard input must be a JSON object.');
      return client.file(data);
    }
    case 'mcp-config': return exportMcp(client, command.id, command.filename);
  }
}

export function redact(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') return secrets.filter(Boolean).reduce((text, secret) => text.split(secret).join('[REDACTED]'), value);
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [String(redact(key, secrets)),
    /token|secret|password|authorization/i.test(key) ? '[REDACTED]' : redact(item, secrets)]));
  return value;
}
