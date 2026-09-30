import { z } from 'zod';
import { AppError, canonical } from './index.ts';

export type OfficeHost = 'excel' | 'word' | 'powerpoint';
export const HOST_TEXT_LIMITS = { items: 50, start: 10000, text: 32767, pageText: 131072, ooxml: 1048576, slides: 20 } as const;
const id = z.string().min(1).max(200);
export const hostTextTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('word'), paragraphId: id }).strict(),
  z.object({ kind: z.literal('powerpoint'), slideId: id, shapeId: id }).strict(),
]);
export type HostTextTarget = z.infer<typeof hostTextTargetSchema>;
export const hostTextReadSchema = z.object({
  start: z.number().int().min(0).max(HOST_TEXT_LIMITS.start).default(0),
  count: z.number().int().min(1).max(HOST_TEXT_LIMITS.items).default(20),
  slideId: id.optional(),
  shapeId: id.optional(),
}).strict().refine(v => !v.shapeId || !!v.slideId, 'shapeId requires slideId');
export type HostTextReadRequest = z.input<typeof hostTextReadSchema>;
export const hostTextWriteSchema = z.object({
  target: hostTextTargetSchema,
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
  text: z.string().max(HOST_TEXT_LIMITS.text),
  operationId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),
}).strict().superRefine((value, context) => {
  if (value.target.kind === 'word' && /[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u2028\u2029]/.test(value.text))
    context.addIssue({ code: 'custom', message: 'Replace exactly one paragraph; structural control characters are not allowed.' });
});
export type HostTextWriteRequest = z.infer<typeof hostTextWriteSchema>;

export interface HostTextState {
  target: HostTextTarget;
  /** Revisions and Word paragraph IDs must be discarded after a host reload. */
  sessionId: string;
  text: string;
  /** Word includes OOXML to detect rich-content edits, not only plain-text edits. */
  contentHash?: string;
  /** Local paragraph content/format comparison, NOT a write revision or permission. */
  semanticHash?: string;
  revision: string;
}
export interface HostTextPage {
  kind: 'word' | 'powerpoint';
  items: HostTextState[];
  start: number;
  nextStart?: number;
  /** Pagination counts paragraphs, slides, or shapes, never text characters. */
  scope: 'paragraphs' | 'slides' | 'shapes';
  sections?: { id: string; name: string }[];
  skipped?: { slideId: string; shapeId: string; reason: string }[];
}
export interface HostTextWriteResult {
  code: 'VERIFIED' | 'REVISION_CONFLICT' | 'READBACK_MISMATCH' | 'WRITE_OUTCOME_UNKNOWN';
  verified: boolean;
  operationId?: string;
  before?: HostTextState;
  after?: HostTextState;
  current?: HostTextState;
  revision?: string;
  /** Office.js has no atomic compare-and-swap; this is optimistic, target-scoped protection. */
  concurrency: 'optimistic';
}

export async function shaCanonical(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function textState(input: Omit<HostTextState, 'revision'>): Promise<HostTextState> {
  if (input.text.length > HOST_TEXT_LIMITS.text) throw new AppError('TEXT_LIMIT', 'Target text exceeds the bounded text limit.');
  const stable = { target: input.target, sessionId: input.sessionId, text: input.text, contentHash: input.contentHash };
  if(input.semanticHash!==undefined&&!/^[a-f0-9]{64}$/.test(input.semanticHash))throw new AppError('TEXT_STATE','Invalid paragraph semantic hash.');
  return { ...stable,...(input.semanticHash?{semanticHash:input.semanticHash}:{}),revision:await shaCanonical(stable) };
}
export function assertPageSize(items: HostTextState[]): void {
  if (items.length > HOST_TEXT_LIMITS.items || items.reduce((n, item) => n + item.text.length, 0) > HOST_TEXT_LIMITS.pageText)
    throw new AppError('TEXT_LIMIT', 'Page is too large; request fewer items.');
}
export function assertPlainParagraph(ooxml: string): void {
  if (ooxml.length > HOST_TEXT_LIMITS.ooxml) throw new AppError('TEXT_LIMIT', 'Paragraph OOXML exceeds the safety limit.');
  // Refuse replacement of non-text payloads and revision-marked content, rather than silently deleting them.
  if (/<(?:[\w.-]+:)?(?:drawing|object|pict|fldChar|fldSimple|instrText|sdt|ins|del|moveFrom|moveTo|footnoteReference|endnoteReference|commentRangeStart|bookmarkStart|hyperlink|oMath|altChunk)\b/.test(ooxml))
    throw new AppError('UNSUPPORTED_TARGET', 'Only plain paragraphs without embedded objects, fields, annotations, or tracked changes can be replaced.');
}
