import test from 'node:test';
import assert from 'node:assert/strict';
import { compatibilityState, inspectCodexProtocol, nativeVersion } from '../packages/native-sessions/compatibility.ts';
const entry = (method: string, fields: string[]) => ({ properties: { method: { enum: [method] }, params: {
  type: 'object', properties: Object.fromEntries(fields.map(field => [field, { type: 'string' }])), required: fields,
} } });
function bundle() {
  return { requests: { oneOf: [entry('initialize', ['clientInfo', 'capabilities']), entry('thread/resume', ['threadId']), entry('thread/queue/add', ['threadId', 'clientUserMessageId', 'input'])] },
    notifications: { oneOf: ['turn/started', 'turn/completed', 'item/started', 'item/completed'].map(method => entry(method, ['threadId', method.startsWith('turn/') ? 'turn' : 'item'])) },
    queueResponse: { definitions: { Receipt: { properties: { id: { type: 'string' }, clientUserMessageId: { type: 'string' } } } }, properties: { queuedSubmission: { $ref: '#/definitions/Receipt' } } } };
}

test('installed native versions are recognized without assuming a newer release is accepted', () => {
  assert.equal(nativeVersion('codex', 'codex-cli 0.159.2'), '0.159.2');
  assert.equal(nativeVersion('claude', '2.1.285 (Claude Code)'), '2.1.285');
  assert.equal(compatibilityState('codex', '0.159.2').state, 'needs-validation');
  assert.equal(compatibilityState('codex', '0.157.0').baselineMatch, false);
  assert.equal(nativeVersion('codex', 'codex-cli 0.157.0\r\n'), '0.157.0');
  assert.equal(nativeVersion('claude', '2.1.282 (Claude Code)'), '2.1.282');
  assert.throws(() => nativeVersion('codex', 'something 0.157.0'));
  assert.equal(compatibilityState('codex', '0.158.0').state, 'needs-validation');
  const evidence = { version: '0.157.0', fingerprint: 'a', protocolPassed: true, functionalPassed: true };
  assert.equal(compatibilityState('codex', '0.157.0', evidence, 'a').state, 'accepted');
  assert.equal(compatibilityState('codex', '0.157.0', evidence, 'b').state, 'needs-validation');
  assert.equal(compatibilityState('codex', '0.158.0', evidence, 'a').state, 'needs-validation');
});

test('Codex capability inspection permits additive APIs but rejects required-argument and receipt breaks', () => {
  const value = bundle(); const accepted = inspectCodexProtocol(value);
  assert.equal(accepted.compatibleShape, true);
  value.requests.oneOf.push(entry('future/read', ['optional']));
  assert.equal(inspectCodexProtocol(value).compatibleShape, true);
  value.requests.oneOf[2].properties.params.required.push('newRequired');
  const changed = inspectCodexProtocol(value);
  assert.equal(changed.queuedSend, false); assert.equal(changed.sessionRead, true);
  assert.ok(changed.reasons.includes('new-required-field:thread/queue/add:newRequired'));
  assert.notEqual(changed.fingerprint, accepted.fingerprint);
  const bad = bundle(); bad.queueResponse.definitions.Receipt.properties.id.type = 'integer';
  assert.equal(inspectCodexProtocol(bad).queuedSend, false);
});

test('removed methods, changed public event shapes and external references fail closed', () => {
  const value = bundle(); value.requests.oneOf.pop();
  assert.equal(inspectCodexProtocol(value).queuedSend, false);
  const event = bundle(); delete (event.notifications.oneOf[0].properties.params.properties as any).threadId;
  assert.equal(inspectCodexProtocol(event).publicEvents, false);
  const external = bundle(); external.queueResponse.properties.queuedSubmission.$ref = 'https://untrusted/receipt';
  assert.equal(inspectCodexProtocol(external).queuedSend, false);
});
