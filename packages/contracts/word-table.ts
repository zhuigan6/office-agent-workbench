import {z} from 'zod';

export const wordTableReferenceSchema=z.object({tableIndex:z.number().int().min(1).max(1000),tableStart:z.number().int().nonnegative(),rows:z.number().int().min(1).max(20),columns:z.number().int().min(1).max(20),hostSessionId:z.string().min(1).max(200),revision:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
