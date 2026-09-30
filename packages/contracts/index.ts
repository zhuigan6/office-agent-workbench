import { z } from 'zod';

export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export type Cell = string | number | boolean | null;
export interface RangeState {
  sheetId: string;
  sheetName: string;
  address: string;
  values: Cell[][];
  formulas: Cell[][];
  numberFormat: string[][];
}
export interface RangeSnapshot extends RangeState { revision: string }
export interface DocumentBinding {
  documentId: string;
  hostSessionId: string;
  name: string;
  kind: 'excel' | 'word' | 'powerpoint';
  capabilities: string[];
  lastSeen: number;
}
export interface Operation {
  id: string;
  documentId: string;
  kind: string;
  status: 'queued' | 'running' | 'applied' | 'conflict' | 'failed' | 'unknown';
  payload: unknown;
  result: unknown;
  createdAt: number;
  updatedAt: number;
}

export function rangeDimensions(address: string): { rows: number; columns: number } {
  const match = /^\$?([A-Z]{1,3})\$?([1-9][0-9]{0,6})(?::\$?([A-Z]{1,3})\$?([1-9][0-9]{0,6}))?$/i.exec(address);
  if (!match) throw new AppError('INVALID_RANGE', 'Use a bounded range such as A1:D12.');
  const col = (letters: string) => [...letters.toUpperCase()].reduce((v, x) => v * 26 + x.charCodeAt(0) - 64, 0);
  const c1 = col(match[1]), r1 = Number(match[2]);
  const c2 = col(match[3] || match[1]), r2 = Number(match[4] || match[2]);
  if (r2 < r1 || c2 < c1 || r2 > 1048576 || c2 > 16384 || (r2 - r1 + 1) * (c2 - c1 + 1) > 1000)
    throw new AppError('RANGE_LIMIT', 'Select at most 1,000 cells inside the worksheet.');
  return { rows: r2 - r1 + 1, columns: c2 - c1 + 1 };
}

const cell = z.union([z.string().max(32767), z.number().finite(), z.boolean(), z.null()]);
const matrix = z.array(z.array(cell).min(1).max(1000)).min(1).max(1000);
export const rangeRequestSchema = z.object({
  documentId: z.string().min(1).max(100),
  sheet: z.string().min(1).max(150),
  range: z.string().min(1).max(30),
});
export const writeRequestSchema = rangeRequestSchema.extend({
  operationId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
  values: matrix.optional(),
  formulas: matrix.optional(),
  numberFormat: z.array(z.array(z.string().max(200))).optional(),
}).strict().refine(v => !(v.values && v.formulas), 'Choose values or formulas, not both')
  .refine(v => v.values || v.formulas || v.numberFormat, 'An edit is required');
export type WriteRequest = z.infer<typeof writeRequestSchema>;

export function validateWrite(input: unknown): WriteRequest {
  const value = writeRequestSchema.parse(input);
  const { rows, columns } = rangeDimensions(value.range);
  for (const data of [value.values, value.formulas, value.numberFormat]) {
    if (data && (data.length !== rows || data.some(row => row.length !== columns)))
      throw new AppError('MATRIX_SHAPE', 'Matrix dimensions must match the target range.');
  }
  if (value.values?.some(row => row.some(c => typeof c === 'string' && /^[=+@]/.test(c))))
    throw new AppError('FORMULA_IN_VALUES', 'Send formulas explicitly; values are literal data.');
  return value;
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
