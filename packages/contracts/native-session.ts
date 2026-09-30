import { z } from 'zod';
import { AppError } from './index.ts';

export const NATIVE_SESSION_LIMITS = { text: 32_768, structuredBytes: 65_536, page: 100, leaseMs: 300_000 } as const;
export const nativeIdSchema = z.string().min(1).max(200).refine(v => v.trim() === v && !/[\x00-\x1f]/.test(v));
export const nativeVendorSchema = z.enum(['codex', 'claude']);
export const nativeCapabilitiesSchema = z.object({
  publicEvents: z.boolean(), sendUserMessages: z.boolean(), toolEvents: z.boolean(),
}).strict();
export const nativeLinkSchema = z.object({
  linkId: nativeIdSchema, threadId: nativeIdSchema, vendor: nativeVendorSchema,
  vendorSessionId: nativeIdSchema, workingDirectory: z.string().min(1).max(4096),
  ownerLink: z.object({ principalId: nativeIdSchema }).strict(), capabilities: nativeCapabilitiesSchema,
}).strict();
export const nativeOwnerSchema = z.object({
  ownerId: nativeIdSchema, launchId: nativeIdSchema, ownerEpoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
export const nativeSourceSchema = z.object({ vendor: nativeVendorSchema, vendorSessionId: nativeIdSchema }).strict();
const text = z.string().max(NATIVE_SESSION_LIMITS.text);
const base = { ...nativeSourceSchema.shape, vendorEventId: nativeIdSchema };
export const nativePublicEventSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('user.text'), text }).strict(),
  z.object({ ...base, kind: z.literal('assistant.text'), text }).strict(),
  z.object({ ...base, kind: z.literal('tool.call'), toolCallId: nativeIdSchema, name: nativeIdSchema, data: z.unknown() }).strict(),
  z.object({ ...base, kind: z.literal('tool.result'), toolCallId: nativeIdSchema, text: text.optional(), data: z.unknown().optional() }).strict(),
  z.object({ ...base, kind: z.literal('turn.started'), turnId: nativeIdSchema }).strict(),
  z.object({ ...base, kind: z.literal('turn.completed'), turnId: nativeIdSchema }).strict(),
  z.object({ ...base, kind: z.literal('owner.status'), status: z.enum(['active', 'uncertain', 'released']) }).strict(),
]);
export const nativeMessageSchema = z.object({ messageId: nativeIdSchema, text: text.min(1) }).strict();
export const nativeReplaySchema = z.object({
  after: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.number().int().min(1).max(NATIVE_SESSION_LIMITS.page).default(50),
}).strict();
export type NativeLinkInput = z.infer<typeof nativeLinkSchema>;
export type NativeOwner = z.infer<typeof nativeOwnerSchema>;
export type NativeSource = z.infer<typeof nativeSourceSchema>;
export type NativePublicEvent = z.infer<typeof nativePublicEventSchema>;
export interface NativeSessionLink extends NativeLinkInput {
  ownerEpoch: number;
  owner: (NativeOwner & { leaseExpiresAt: number; status: 'active' | 'uncertain' }) | null;
  activeTurnId: string | null;
}
export interface NativeOutboundMessage {
  messageId: string; text: string; state: 'queued' | 'unknown' | 'accepted' | 'completed';
  execution: NativeOwner | null; vendorRequestId: string | null; createdAt: number; updatedAt: number;
}
export interface NativeJournalEvent { seq: number; event: NativePublicEvent }

export function parseNative<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new AppError('NATIVE_INVALID_INPUT', 'Invalid or oversized native session input.');
  return result.data;
}

// Structured public tool payloads only, never arbitrary transcript envelopes.
export function sanitizeNativeData(input: unknown): unknown {
  let nodes = 0;
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 4096 || depth > 12) throw new AppError('NATIVE_DATA_LIMIT', 'Public tool data exceeds structural limits.');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string' && value.length <= NATIVE_SESSION_LIMITS.text) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map(v => visit(v, depth + 1));
    if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
      const entries = Object.entries(value);
      return Object.fromEntries(entries.filter(([key]) => {
        const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
        return !/password|passwd|secret|token|credential|authorization|apikey|accesskey|privatekey|cookie|thinking|reasoning|system|developer|transcript/.test(normalized)
          && !['auth', 'authentication', 'headers'].includes(normalized)
          && !['__proto__', 'constructor', 'prototype'].includes(key);
      }).map(([key, v]) => {
        if (key.length > 200) throw new AppError('NATIVE_DATA_LIMIT', 'Public tool field name exceeds limits.');
        return [key, visit(v, depth + 1)];
      }));
    }
    throw new AppError('NATIVE_INVALID_DATA', 'Only bounded JSON public tool data is supported.');
  };
  const value = visit(input, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > NATIVE_SESSION_LIMITS.structuredBytes)
    throw new AppError('NATIVE_DATA_LIMIT', 'Public tool data exceeds byte limits.');
  return value;
}
