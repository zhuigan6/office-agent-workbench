import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { ClientError, WorkbenchClient, httpsTransport, type RequestData, type Transport } from '../packages/client/index.ts';
import { execute, exportMcp, parseArgs, readStdin, redact, validateMcpConfig } from '../apps/cli/commands.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
function fixture(response: unknown = { ok: true }, status = 200) {
  const requests: RequestData[] = [];
  const transport: Transport = async request => {
    requests.push(request);
    return { status, body: Buffer.from(JSON.stringify(response)) };
  };
  return { requests, client: new WorkbenchClient({ port: 18443, token: 'ui-test-secret', ca: 'test-ca', transport }) };
}
const noStdin = async (): Promise<string> => { throw new Error('Unexpected stdin'); };
test('history CLI shares archive routes without creating or resuming agent sessions',async()=>{
  const {client,requests}=fixture(),hash='a'.repeat(64);
  await execute(parseArgs(['archives']),client,noStdin);
  await execute(parseArgs(['archive',hash,'--offset','50']),client,noStdin);
  assert.deepEqual(requests.map(r=>r.url.pathname),['/api/archives','/api/archives/'+hash]);
  assert.equal(requests[1].url.searchParams.get('offset'),'50');
  for(const args of [['archive','../path'],['archive',hash,'--offset','-1'],['import-history'],['archives','extra']])assert.throws(()=>parseArgs(args));
  await temporary(async directory=>{const filename=path.join(directory,'history.json');await writeFile(filename,'{"format":"office-workbench-history/v1"}');await execute(parseArgs(['import-history',filename]),client,noStdin);assert.equal(requests[2].url.pathname,'/api/archives');assert.equal(requests[2].body!.toString(),'{"format":"office-workbench-history/v1"}');});
});
test('CLI accepts a stable request ID and preserves it on retry',async()=>{
  const {client,requests}=fixture();const args=['send','chat','hello','--request-id','stable-request-01'];
  await execute(parseArgs(args),client,noStdin);await execute(parseArgs(args),client,noStdin);
  assert.equal(JSON.parse(requests[0].body!.toString()).requestId,'stable-request-01');
  assert.deepEqual(requests[0].body,requests[1].body);
  assert.throws(()=>parseArgs(['send','chat','hello','--request-id','short']));
});
const scoped = () => ({ mcpServers: { 'office-workbench': { command: process.execPath,
  args: ['--import', 'file:///fixture/tsx/loader.mjs', path.join(root, 'apps/local-host/mcp.ts')],
  env: { WORKBENCH_URL: 'https://localhost:18443', WORKBENCH_TOOL_TOKEN: 'scoped-test-secret',
    WORKBENCH_CA: path.join(root, '.local/server.cer') } } } });
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(root, 'apps/cli/.test-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('parses all commands, stdin, paging, and attachment flags', () => {
  for (const kind of ['status', 'conversations', 'file'] as const) assert.deepEqual(parseArgs([kind]), { kind });
  assert.deepEqual(parseArgs(['messages', 'chat_1', '--before', 'a+/=']), { kind: 'messages', id: 'chat_1', before: 'a+/=' });
  assert.deepEqual(parseArgs(['send', 'chat-1', '-', '--file', 'f-1']), { kind: 'send', id: 'chat-1', files: ['f-1'], message: undefined });
  assert.deepEqual(parseArgs(['send', 'chat-1', '--file', 'f-1', '--', '--literal']), { kind: 'send', id: 'chat-1', files: ['f-1'], message: '--literal' });
  assert.deepEqual(parseArgs(['files']), { kind: 'files', conversation: undefined });
  assert.deepEqual(parseArgs(['upload', 'a b.xlsx', 'chat-1']), { kind: 'upload', filename: 'a b.xlsx', conversation: 'chat-1' });
  assert.deepEqual(parseArgs(['mcp-config', 'chat-1', 'new.json']), { kind: 'mcp-config', id: 'chat-1', filename: 'new.json' });
});

test('rejects unknown commands, extra args, malformed IDs and flags', () => {
  for (const args of [['shell'], ['status', 'extra'], ['send'], ['messages', '../escape'],
    ['messages', 'c', '--before'], ['messages', 'c', '--before', ''], ['files', 'a', 'b'],
    ['send', 'c', '--token', 'secret'], ['send', 'c', '--file'], ['send', 'c', 'one', 'two'],
    ['upload'], ['mcp-config', 'c'], ['send', 'c', '--', 'one', 'two']]) {
    assert.throws(() => parseArgs(args), ClientError);
  }
});

test('GET routes preserve existing conversations and URL-encode cursors', async () => {
  const { client, requests } = fixture();
  for (const args of [['status'], ['conversations'], ['messages', 'c', '--before', 'a+/='], ['files', 'c']]) {
    await execute(parseArgs(args), client, noStdin);
  }
  assert.deepEqual(requests.map(r => r.url.pathname), ['/api/status', '/api/conversations', '/api/conversations/c/messages', '/api/files']);
  assert.equal(requests[2].url.searchParams.get('before'), 'a+/=');
  assert.equal(requests[3].url.searchParams.get('conversation'), 'c');
  assert.ok(requests.every(r => r.method === 'GET' && r.headers.Authorization === 'Bearer ui-test-secret' && r.ca === 'test-ca'));
});

test('sends UTF-8 message and file IDs to the existing conversation', async () => {
  const { client, requests } = fixture();
  await execute(parseArgs(['send', 'existing', '--file', 'f-1']), client, async () => '\u4f60\u597d\nworld');
  assert.equal(requests[0].url.pathname, '/api/conversations/existing/messages');
  const payload = JSON.parse(requests[0].body!.toString());
  assert.match(payload.requestId, /^[\w-]{36}$/);
  assert.deepEqual({content:payload.content,files:payload.files}, { content: '\u4f60\u597d\nworld', files: ['f-1'] });
  assert.equal(Number(requests[0].headers['Content-Length']), requests[0].body!.length);
  assert.equal(requests.length, 1);
  assert.throws(() => client.send('c', '  '), ClientError);
  assert.throws(() => client.send('c', 'a'.repeat(20_001)), ClientError);
});

test('stdin joins split UTF-8 byte sequences and strips BOM', async () => {
  const data = Buffer.from('\uFEFF\u4f60\u597d');
  async function* chunks() { for (const byte of data) yield Buffer.from([byte]); }
  assert.equal(await readStdin(chunks()), '\u4f60\u597d');
  await assert.rejects(readStdin(chunks(), 2), { code: 'INPUT_LIMIT' });
});

test('raw binary uploads preserve bytes and UTF-8 filenames', async () => {
  await temporary(async directory => {
    const bytes = Buffer.from([0, 255, 128, 13, 10, 0, 42]);
    const filename = path.join(directory, '\u62a5\u544a + #.xlsx');
    await writeFile(filename, bytes);
    const { client, requests } = fixture();
    await execute(parseArgs(['upload', filename, 'c']), client, noStdin);
    assert.deepEqual(requests[0].body, bytes);
    assert.equal(requests[0].url.searchParams.get('name'), path.basename(filename));
    assert.equal(requests[0].url.searchParams.get('conversation'), 'c');
    assert.equal(requests[0].headers['Content-Type'], 'application/octet-stream');
    assert.equal(requests[0].headers['Content-Length'], String(bytes.length));
    await assert.rejects(execute(parseArgs(['upload', directory]), client, noStdin), { code: 'UPLOAD' });
  });
});

test('file command accepts only JSON objects and uses the existing backend', async () => {
  const { client, requests } = fixture();
  await execute({ kind: 'file' }, client, async () => '{"action":"list"}');
  assert.equal(requests[0].url.pathname, '/api/file-command');
  assert.deepEqual(JSON.parse(requests[0].body!.toString()), { action: 'list' });
  for (const value of ['null', '[]', 'broken', '"string"']) {
    await assert.rejects(execute({ kind: 'file' }, client, async () => value), { code: 'INPUT_JSON' });
  }
  assert.equal(requests.length, 1);
});

test('HTTP errors never include server bodies, including redirects', async () => {
  for (const status of [302, 401, 500]) {
    const { client } = fixture({ message: 'ui-test-secret scoped-test-secret' }, status);
    await assert.rejects(client.status(), error => error instanceof ClientError && error.code === 'HTTP_ERROR' &&
      !error.message.includes('secret') && error.message.includes(String(status)));
  }
});

test('transport and malformed response failures are sanitized', async () => {
  const create = (transport: Transport) => new WorkbenchClient({ port: 18443, token: 'secret', ca: 'ca', transport });
  await assert.rejects(create(async () => { throw new Error('Authorization: secret'); }).status(), { code: 'CONNECTION' });
  await assert.rejects(create(async () => ({ status: 200, body: Buffer.from('secret: malformed JSON') })).status(), { code: 'INVALID_RESPONSE' });
  assert.throws(() => new WorkbenchClient({ port: 0, token: 'secret', ca: 'ca' }), { code: 'CONFIG' });
});

test('HTTPS wall-clock timeout includes a stalled TLS handshake', async () => {
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => { sockets.add(socket); socket.on('error', () => {}); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as net.AddressInfo;
    await assert.rejects(httpsTransport({ url: new URL(`https://127.0.0.1:${address.port}`), method: 'GET', headers: {}, ca: '', timeoutMs: 50 }), { code: 'TIMEOUT' });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('scoped export writes only a new file and returns no scoped token', async () => {
  await temporary(async directory => {
    const config = scoped();
    const { client, requests } = fixture(config);
    const filename = path.join(directory, 'scoped.json');
    const result = await exportMcp(client, 'existing', filename);
    assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), config);
    assert.deepEqual(result, { written: true, outputPath: filename });
    assert.equal(JSON.stringify(result).includes('scoped-test-secret'), false);
    assert.equal(requests[0].url.pathname, '/api/conversations/existing/access');
    assert.equal(requests[0].method, 'POST');
    await assert.rejects(exportMcp(client, 'existing', filename), { code: 'EXISTS' });
    assert.equal(requests.length, 1);
    assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), config);
  });
});

test('export wx preserves a competing file created after preflight', async () => {
  await temporary(async directory => {
    const filename = path.join(directory, 'race.json');
    const client = new WorkbenchClient({ port: 18443, token: 'test', ca: 'ca', transport: async () => {
      await writeFile(filename, 'keep this');
      return { status: 200, body: Buffer.from(JSON.stringify(scoped())) };
    } });
    await assert.rejects(exportMcp(client, 'existing', filename), { code: 'EXPORT' });
    assert.equal(await readFile(filename, 'utf8'), 'keep this');
  });
});

test('export rejects wrong origin and omits unrelated settings', () => {
  const config = scoped();
  Object.assign(config.mcpServers['office-workbench'].env, { CORE_SECRET: 'never export' });
  assert.equal(JSON.stringify(validateMcpConfig(config, 'https://localhost:18443')).includes('CORE_SECRET'), false);
  assert.throws(() => validateMcpConfig(config, 'https://localhost:9999'), { code: 'INVALID_ACCESS' });
  assert.throws(() => validateMcpConfig({ token: 'bad' }, 'https://localhost:18443'), { code: 'INVALID_ACCESS' });
});

test('export refuses global credentials and creates no output for invalid grants', async () => {
  await temporary(async directory => {
    const config = scoped();
    config.mcpServers['office-workbench'].env.WORKBENCH_TOOL_TOKEN = 'ui-test-secret';
    const { client } = fixture(config);
    const filename = path.join(directory, 'invalid.json');
    await assert.rejects(exportMcp(client, 'existing', filename), { code: 'INVALID_ACCESS' });
    await assert.rejects(readFile(filename), { code: 'ENOENT' });
  });
});

test('stdout redaction handles nested credentials and exact secrets in text and keys', () => {
  assert.deepEqual(redact({ uiToken: 'anything', text: 'the secret', nested: [{ password: 'x' }], secretKey: 'value' }, ['secret']),
    { uiToken: '[REDACTED]', text: 'the [REDACTED]', nested: [{ password: '[REDACTED]' }], '[REDACTED]Key': '[REDACTED]' });
});

test('import is side-effect free, help needs no config, and command errors use stderr only', () => {
  const env = { ...process.env, WORKBENCH_DATA_DIR: path.join(root, 'apps/cli/does-not-exist') };
  const imported = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "await import('./apps/cli/main.ts')"], { cwd: root, env, encoding: 'utf8' });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, '');
  assert.equal(imported.stderr, '');
  const help = spawnSync(process.execPath, ['--import', 'tsx', 'apps/cli/main.ts', '--help'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.ok(JSON.parse(help.stdout).usage);
  const failed = spawnSync(process.execPath, ['--import', 'tsx', 'apps/cli/main.ts', 'status'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, '');
  assert.equal(JSON.parse(failed.stderr).error.code, 'CONFIG');
});
