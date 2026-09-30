import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { rootCertificates } from 'node:tls';
import https from 'node:https';
import { EventEmitter, once } from 'node:events';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main, parseArgs, loadCa } from '../apps/cli/scoped.ts';
import { ScopedClient, toolRoutes, validateConnection, parseInput, inputLimit, responseLimit, type ToolCommand } from '../packages/client/scoped.ts';
import { ClientError, httpsTransport, type RequestData, type Transport } from '../packages/client/index.ts';

const token = 'scoped-test-secret';
const root = fileURLToPath(new URL('..', import.meta.url));
const client = (transport: Transport) => new ScopedClient({ url: 'https://localhost:18443', token, ca: rootCertificates[0], transport });

test('strict original URL and bearer validation rejects normalized and remote alternatives', () => {
  for (const url of ['https://localhost', 'https://localhost:18443', 'https://127.0.0.1:443']) {
    assert.ok(validateConnection(url, token));
  }
  for (const url of [undefined, '', 'http://localhost', 'https://localhost/', 'https://localhost/a/..',
    'https://localhost?', 'https://localhost#', 'https://x@localhost', 'https://localhost.evil',
    'https://127.1', 'https://2130706433', 'https://[::1]', 'https://LOCALHOST',
    'https://%6cocalhost', ' https://localhost', 'https://localhost\n', 'https://localhost\\evil',
    'https://localhost:0', 'https://localhost:65536']) {
    assert.throws(() => validateConnection(url, token), { code: 'CONFIG' });
  }
  for (const bad of ['', 'x\r\nInjected: yes', 'a b', '\u4f60', 'a'.repeat(8193)]) {
    assert.throws(() => validateConnection('https://localhost', bad), { code: 'CONFIG' });
  }
});

test('explicit commands only, bounded JSON objects, no option or route escape', () => {
  for (const command of Object.keys(toolRoutes)) assert.equal(parseArgs([command, '--json', '{}']).command, command);
  for (const args of [['status'], ['mcp-config'], ['/api/status'], ['/tools/read'], ['__proto__'],
    ['constructor'], ['file', '--route', '/api/admin'], ['file', '--json'], ['file', '-', 'extra']]) {
    assert.throws(() => parseArgs(args), { code: 'ARGUMENT' });
  }
  for (const raw of ['null', '[]', '1', '"secret"', '{broken']) assert.throws(() => parseInput(raw), { code: 'INPUT_JSON' });
  assert.deepEqual(parseInput('\uFEFF{"action":"list"}'), { action: 'list' });
  assert.throws(() => parseInput(JSON.stringify({ text: '\u4f60'.repeat(inputLimit / 2) })), { code: 'INPUT_LIMIT' });
});

test('every command uses precisely the MCP backend with unchanged operation/revision payloads', async () => {
  const requests: RequestData[] = [];
  const api = client(async request => { requests.push(request); return { status: 200, body: Buffer.from('{}') }; });
  const mcp = await readFile(new URL('../apps/local-host/mcp.ts', import.meta.url), 'utf8');
  const payload = { operationId: 'stable-1', expectedRevision: 'rev-1', selectionId: 'frozen-1', text: '\u4f60' };
  for (const command of Object.keys(toolRoutes) as ToolCommand[]) await api.invoke(command, payload);
  assert.deepEqual(requests.map(r => r.url.pathname), Object.values(toolRoutes));
  for (const request of requests) {
    assert.ok(mcp.includes(`'${request.url.pathname}'`));
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.Authorization, `Bearer ${token}`);
    assert.equal(request.ca, rootCertificates[0]);
    assert.equal(request.timeoutMs, 90000);
    assert.equal(Number(request.headers['Content-Length']), request.body!.length);
    assert.deepEqual(JSON.parse(request.body!.toString()), payload);
  }
  await assert.rejects(api.invoke('/api/status' as ToolCommand, {}), { code: 'ARGUMENT' });
  assert.equal(requests.length, Object.keys(toolRoutes).length);
});

test('redirects, auth failures, malformed/oversized responses and malicious errors are never echoed or retried', async () => {
  for (const status of [301, 302, 401, 403, 409, 500]) {
    let calls = 0;
    await assert.rejects(client(async () => { calls++; return { status, body: Buffer.from(token) }; }).invoke('file', {}),
      error => error instanceof Error && !error.message.includes(token));
    assert.equal(calls, 1);
  }
  await assert.rejects(client(async () => { throw new ClientError(token, token); }).invoke('file', {}), { code: 'CONNECTION' });
  await assert.rejects(client(async () => ({ status: 200, body: Buffer.from(token) })).invoke('file', {}), { code: 'INVALID_RESPONSE' });
  await assert.rejects(client(async () => ({ status: 200, body: Buffer.alloc(responseLimit + 1) })).invoke('file', {}), { code: 'RESPONSE_LIMIT' });
});

test('HTTPS transport explicitly verifies the provided CA and never follows redirects', async t => {
  let captured: https.RequestOptions | undefined;
  let calls = 0;
  t.mock.method(https, 'request', (_url: URL, options: https.RequestOptions, callback: (res: EventEmitter) => void) => {
    calls++; captured = options;
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      const res = Object.assign(new EventEmitter(), { statusCode: 302, headers: { location: 'https://remote.invalid' } });
      callback(res); res.emit('data', Buffer.from('{}')); res.emit('end');
    };
    return req;
  });
  const response = await httpsTransport({ url: new URL('https://localhost/tools/file'), method: 'POST', headers: {}, ca: rootCertificates[0], timeoutMs: 100 });
  assert.equal(captured!.rejectUnauthorized, true);
  assert.equal(captured!.ca, rootCertificates[0]);
  assert.equal(response.status, 302);
  assert.equal(calls, 1);
});

test('real transport wall-clock deadline covers a stalled TLS handshake', async () => {
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => { sockets.add(socket); socket.on('error', () => {}); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const port = (server.address() as net.AddressInfo).port;
    await assert.rejects(httpsTransport({ url: new URL(`https://127.0.0.1:${port}/tools/file`), method: 'POST',
      headers: {}, ca: rootCertificates[0], timeoutMs: 50 }), { code: 'TIMEOUT' });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('CLI reads only explicit certificate, bounds stdin, redacts successful output and sanitizes failures', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workbench-scoped-test-'));
  try {
    const cert = path.join(directory, 'ca.pem');
    await writeFile(cert, rootCertificates[0]);
    const env = { WORKBENCH_URL: 'https://localhost:18443', WORKBENCH_TOOL_TOKEN: token, WORKBENCH_CA: cert };
    let out = '', err = '', calls = 0;
    const options = { env, isTTY: false, stdout: (s: string) => { out += s; }, stderr: (s: string) => { err += s; },
      transport: async (_request: RequestData) => { calls++; return { status: 200,
        body: Buffer.from(JSON.stringify({ text: token, [token]: token, nested: { authorization: 'other-secret' } })) }; } };
    async function* input() { for (const byte of Buffer.from('\uFEFF{"text":"\u4f60"}')) yield Buffer.from([byte]); }
    assert.equal(await main(['file', '-'], { ...options, input: input() }), 0);
    assert.equal(err, ''); assert.ok(!out.includes(token)); assert.ok(!out.includes('other-secret'));
    assert.equal(calls, 1);
    out = ''; err = '';
    async function* oversized() { yield Buffer.alloc(inputLimit + 1); }
    assert.equal(await main(['file'], { ...options, input: oversized() }), 1);
    assert.equal(out, ''); assert.equal(JSON.parse(err).error.code, 'INPUT_LIMIT'); assert.equal(calls, 1);
    await writeFile(cert, token);
    await assert.rejects(loadCa(cert), error => error instanceof Error && !error.message.includes(token));
    await writeFile(cert, Buffer.alloc(65537));
    await assert.rejects(loadCa(cert), { code: 'CONFIG' });
    await assert.rejects(loadCa(directory), { code: 'CONFIG' });
    await assert.rejects(loadCa('relative.pem'), { code: 'CONFIG' });
    out = ''; err = '';
    assert.equal(await main(['capabilities'], options), 1);
    assert.equal(out, ''); assert.equal(JSON.parse(err).error.code, 'CONFIG');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('entrypoint help/import need no credentials; missing scoped env never falls back to local admin config', () => {
  const env = { ...process.env, WORKBENCH_URL: '', WORKBENCH_TOOL_TOKEN: '', WORKBENCH_CA: '', NODE_OPTIONS: '' };
  const run = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', ...args], { cwd: root, env, encoding: 'utf8' });
  const imported = run(['--input-type=module', '-e', "await import('./apps/cli/scoped.ts')"]);
  assert.equal(imported.status, 0, imported.stderr); assert.equal(imported.stdout + imported.stderr, '');
  const help = run(['apps/cli/scoped.ts', '--help']);
  assert.equal(help.status, 0, help.stderr); assert.ok(JSON.parse(help.stdout).usage);
  const failed = run(['apps/cli/scoped.ts', 'capabilities']);
  assert.equal(failed.status, 1); assert.equal(failed.stdout, ''); assert.equal(JSON.parse(failed.stderr).error.code, 'CONFIG');
});
