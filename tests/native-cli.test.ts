import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, execute } from '../apps/cli/commands.ts';
import { WorkbenchClient, type RequestData } from '../packages/client/index.ts';
const id = '00000000-0000-0000-0000-000000000001';
test('native CLI reads the same persisted API and cannot create, fork or silently resume a session', async () => {
  const requests: RequestData[] = [];
  const client = new WorkbenchClient({ port: 18443, token: 'private', ca: 'fixture', transport: async request => {
    requests.push(request); return { status: 200, body: Buffer.from('{}') };
  } });
  for (const args of [['native-sessions'], ['native-events', id, '--after', '10'], ['native-receipts', id], ['native-close', id]])
    await execute(parseArgs(args), client, async () => '');
  assert.deepEqual(requests.map(request => request.url.pathname + request.url.search), ['/api/native-sessions', `/api/native-sessions/${id}/events?after=10`, `/api/native-sessions/${id}/receipts?after=0`, `/api/native-sessions/${id}/close`]);
  for (const args of [['native-create'], ['native-resume', id], ['native-events', '../escape'], ['native-events', id, '--after', '-1'], ['native-close', id, 'extra']]) assert.throws(() => parseArgs(args));
});
test('native sends require stable IDs and preserve identical payloads across explicit retries', async () => {
  const requests: RequestData[] = [];
  const client = new WorkbenchClient({ port: 18443, token: 'private', ca: 'fixture', transport: async request => {
    requests.push(request); return { status: 200, body: Buffer.from('{}') };
  } });
  const command = parseArgs(['native-send', id, '-', '--request-id', 'stable-native-01']);
  await execute(command, client, async () => 'hello'); await execute(command, client, async () => 'hello');
  assert.deepEqual(JSON.parse(requests[0].body!.toString()), { messageId: 'stable-native-01', text: 'hello' });
  assert.deepEqual(requests[0].body, requests[1].body);
  for (const args of [['native-send', id, 'hello'], ['native-send', id, 'hello', '--file', 'file', '--request-id', 'stable-native-01']]) assert.throws(() => parseArgs(args));
});
