import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { CodexRpc } from '../packages/native-sessions/codex-rpc.ts';
import { AppError } from '../packages/contracts/index.ts';

function fixture(timeout = 100) {
  const input = new PassThrough(), output = new PassThrough(), frames: any[] = [];
  output.on('data', data => frames.push(JSON.parse(data.toString())));
  const rpc = new CodexRpc(input, output, timeout);
  return { input, output, frames, rpc, async ready() {
    const initialized = rpc.initialize(); input.write(JSON.stringify({ id: 1, result: { userAgent: 'test' } }) + '\n'); await initialized;
  } };
}
const code = (expected: string) => (error: unknown) => error instanceof AppError && error.code === expected;

test('native initialization, split UTF8 frames, notifications and correlated replies', async () => {
  const f = fixture(); try {
    await assert.rejects(f.rpc.request('thread/read', {}), code('NATIVE_NOT_READY'));
    await f.ready(); assert.equal(f.frames[1].method, 'initialized');
    const events: unknown[] = []; f.rpc.on('notification', event => events.push(event));
    const bytes = Buffer.from('{"method":"item/completed","params":{"text":"你好"}}\n');
    const cut = bytes.indexOf(Buffer.from('你')) + 1;
    f.input.write(bytes.subarray(0, cut)); f.input.write(bytes.subarray(cut));
    assert.deepEqual(events, [{ method: 'item/completed', params: { text: '你好' } }]);
    const pending = f.rpc.request('thread/read', { threadId: 'explicit-id', includeTurns: false });
    f.input.write('{"id":2,"result":{"thread":{"id":"explicit-id"}}}\n');
    assert.deepEqual(await pending, { thread: { id: 'explicit-id' } });
  } finally { f.rpc.close(); }
});

test('server approvals fail closed, explicit handlers must reply to pending IDs', async () => {
  const f = fixture(); try {
    await f.ready(); f.input.write('{"id":"approve1","method":"item/commandExecution/requestApproval","params":{}}\n');
    assert.equal(f.frames.at(-1).error.code, -32000);
    f.rpc.on('serverRequest', request => f.rpc.respond(request.id, { decision: 'decline' }));
    f.input.write('{"id":"approve2","method":"item/commandExecution/requestApproval","params":{}}\n');
    assert.deepEqual(f.frames.at(-1).result, { decision: 'decline' });
    assert.throws(() => f.rpc.respond('approve2', {}), code('NATIVE_UNKNOWN_REQUEST'));
  } finally { f.rpc.close(); }
});

test('concurrent initialization cannot send duplicate initialize requests', async () => {
  const f = fixture(); try {
    const pending = f.rpc.initialize();
    await assert.rejects(f.rpc.initialize(), code('NATIVE_STATE_CONFLICT'));
    f.input.write('{"id":1,"result":{}}\n'); await pending;
    assert.equal(f.frames.filter(frame => frame.method === 'initialize').length, 1);
  } finally { f.rpc.close(); }
});

test('timeout never resends; disconnect fences outstanding requests and hides vendor errors', async () => {
  const f = fixture(10); try {
    await f.ready(); await assert.rejects(f.rpc.request('turn/start', {}), code('NATIVE_DISPATCH_UNCERTAIN'));
    assert.equal(f.frames.filter(frame => frame.method === 'turn/start').length, 1);
    const rejected = f.rpc.request('thread/read', {});
    f.input.write('{"id":3,"error":{"message":"private credentials"}}\n');
    await assert.rejects(rejected, error => code('NATIVE_VENDOR_ERROR')(error) && !(error as Error).message.includes('private'));
    const pending = f.rpc.request('thread/read', {}); f.input.end();
    await assert.rejects(pending, code('NATIVE_DISPATCH_UNCERTAIN'));
    await assert.rejects(f.rpc.request('thread/read', {}), code('NATIVE_DISCONNECTED'));
  } finally { f.rpc.close(); }
});

test('malformed and oversized protocol frames close rather than accepting arbitrary output', async () => {
  for (const data of ['not json\n', '[1,2]\n', 'x'.repeat(8 * 1024 * 1024 + 1)]) {
    const f = fixture(); try {
      await f.ready(); let closed = false; f.rpc.on('disconnected', () => { closed = true; });
      f.input.write(data); assert.equal(closed, true);
    } finally { f.rpc.close(); }
  }
});
