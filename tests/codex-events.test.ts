import test from 'node:test';
import assert from 'node:assert/strict';
import { codexPublicEvents } from '../packages/native-sessions/codex-events.ts';
const item = (type: string, data: object = {}, method = 'item/completed', threadId = 'native') => ({
  method, params: { threadId, turnId: 'turn1', item: { id: 'item1', type, ...data } },
});

test('Codex public projection isolates native IDs and emits deterministic completed messages', () => {
  const notification = item('agentMessage', { text: 'hello', reasoning: 'PRIVATE' });
  const events = codexPublicEvents('native', notification);
  assert.deepEqual(codexPublicEvents('native', notification), events);
  assert.equal(events[0].kind, 'assistant.text'); assert.equal(JSON.stringify(events).includes('PRIVATE'), false);
  assert.deepEqual(codexPublicEvents('other', notification), []);
  assert.deepEqual(codexPublicEvents('native', item('agentMessage', { text: 'partial' }, 'item/started')), []);
  const user = codexPublicEvents('native', item('userMessage', { content: [{ type: 'text', text: 'public' }, { type: 'image', url: 'private' }] }));
  assert.equal((user[0] as any).text, 'public');
});

test('reasoning/raw/private events never become public journal entries', () => {
  for (const type of ['reasoning', 'systemMessage', 'developerMessage', 'unknown'])
    assert.deepEqual(codexPublicEvents('native', item(type, { text: 'PRIVATE' })), []);
  assert.deepEqual(codexPublicEvents('native', { method: 'rawResponseItem/completed', params: { text: 'PRIVATE' } }), []);
  assert.throws(() => codexPublicEvents('native', item('agentMessage', { text: 'x'.repeat(32769) })));
});

test('tool lifecycle projects scoped payloads without credential envelopes', () => {
  const call = codexPublicEvents('native', item('mcpToolCall', { tool: 'office_read', server: 'office', arguments: { range: 'A1', token: 'PRIVATE' } }, 'item/started'));
  assert.equal(call[0].kind, 'tool.call'); assert.equal(JSON.stringify(call).includes('PRIVATE'), false);
  const result = codexPublicEvents('native', item('mcpToolCall', { status: 'completed', result: { content: ['ok'], headers: { authorization: 'PRIVATE' } } }));
  assert.equal(result[0].kind, 'tool.result'); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.notEqual(call[0].vendorEventId, result[0].vendorEventId);
});

test('turn identity is mapped without copying private turn content', () => {
  for (const phase of ['started', 'completed']) {
    const event = codexPublicEvents('native', { method: 'turn/' + phase, params: { threadId: 'native', turn: { id: 'turn1', reasoning: 'PRIVATE' } } });
    assert.equal(event[0].kind, 'turn.' + phase); assert.equal(JSON.stringify(event).includes('PRIVATE'), false);
  }
});

test('terminal outcomes distinguish failure/interruption without changing old completion identity or exposing error text',()=>{
  const legacy=codexPublicEvents('native',{method:'turn/completed',params:{threadId:'native',turn:{id:'turn1'}}});
  for(const status of ['completed','failed','interrupted']){
    const events=codexPublicEvents('native',{method:'turn/completed',params:{threadId:'native',turn:{id:'turn1',status,error:{message:'PRIVATE credential or reasoning',rawResponse:'PRIVATE'}}}});
    assert.deepEqual(events[0],legacy[0]);assert.equal(events.length,2);assert.equal(events[1].kind,'turn.outcome');assert.equal((events[1] as any).status,status);assert.notEqual(events[0].vendorEventId,events[1].vendorEventId);assert.ok(!JSON.stringify(events).includes('PRIVATE'));
  }
  const unknown=codexPublicEvents('native',{method:'turn/completed',params:{threadId:'native',turn:{id:'turn1',status:'new-vendor-status'}}});assert.deepEqual(unknown,legacy);
});
test('workspace-routing failure is classified from exact public vendor error, not arbitrary secret messages',()=>{
  const project=(message:string)=>codexPublicEvents('native',{method:'turn/completed',params:{threadId:'native',turn:{id:'turn1',status:'failed',error:{message,additionalDetails:'PRIVATE'}}}})[1] as any;
  assert.equal(project('workspace routing discovery timed out').failureCode,'WORKSPACE_ROUTING_TIMEOUT');assert.equal(project('PRIVATE http://user:secret@example.invalid').failureCode,'VENDOR_TURN_FAILED');assert.ok(!JSON.stringify(project('PRIVATE')).includes('PRIVATE'));
});
