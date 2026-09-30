import { createHash } from 'node:crypto';
import { z } from 'zod';
import { nativeIdSchema, nativePublicEventSchema, parseNative, sanitizeNativeData, type NativePublicEvent } from '../contracts/native-session.ts';
import type { CodexNotification } from './codex-rpc.ts';

const envelope = z.object({ threadId: nativeIdSchema, turnId: nativeIdSchema.optional() }).passthrough();
const itemSchema = z.object({ id: nativeIdSchema, type: z.string().max(100) }).passthrough();
const id = (parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

/** Deliberate public allowlist. Raw responses, reasoning and arbitrary transcript fields never pass through. */
export function codexPublicEvents(sessionId: string, notification: CodexNotification): NativePublicEvent[] {
  parseNative(nativeIdSchema, sessionId);
  if (!['turn/started', 'turn/completed', 'item/started', 'item/completed'].includes(notification.method)) return [];
  const params = parseNative(envelope, notification.params);
  if (params.threadId !== sessionId) return [];
  const base = { vendor: 'codex' as const, vendorSessionId: sessionId };
  if (notification.method.startsWith('turn/')) {
    const turn = parseNative(z.object({ id: nativeIdSchema }).passthrough(), params.turn);
    return [parseNative(nativePublicEventSchema, {
      ...base, vendorEventId: id([sessionId, notification.method, turn.id]),
      kind: notification.method === 'turn/started' ? 'turn.started' : 'turn.completed', turnId: turn.id,
    })];
  }
  const item = parseNative(itemSchema, params.item);
  const eventId = (phase: string) => id([sessionId, params.turnId ?? '', item.id, phase]);
  if (notification.method === 'item/completed' && item.type === 'agentMessage')
    return [parseNative(nativePublicEventSchema, { ...base, vendorEventId: eventId('assistant'), kind: 'assistant.text', text: item.text })];
  if (notification.method === 'item/completed' && item.type === 'userMessage') {
    const content = parseNative(z.array(z.object({ type: z.string().max(100), text: z.string().optional() }).passthrough()).max(100), item.content);
    return [parseNative(nativePublicEventSchema, { ...base, vendorEventId: eventId('user'), kind: 'user.text',
      text: content.filter(part => part.type === 'text').map(part => part.text ?? '').join('\n') })];
  }
  if (item.type === 'mcpToolCall') {
    if (notification.method === 'item/started')
      return [parseNative(nativePublicEventSchema, { ...base, vendorEventId: eventId('tool.call'), kind: 'tool.call',
        toolCallId: item.id, name: parseNative(nativeIdSchema, item.tool), data: sanitizeNativeData({ server: item.server, arguments: item.arguments }) })];
    return [parseNative(nativePublicEventSchema, { ...base, vendorEventId: eventId('tool.result'), kind: 'tool.result',
      toolCallId: item.id, data: sanitizeNativeData({ status: item.status, result: item.result ?? null, error: item.error ?? null }) })];
  }
  return [];
}
