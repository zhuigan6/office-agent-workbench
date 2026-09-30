import {z} from 'zod';
import {rangeDimensions} from './index.ts';

const common={documentId:z.string().min(1).max(200),hostSessionId:z.string().min(1).max(200),contentHash:z.string().regex(/^[a-f0-9]{64}$/),preview:z.string().max(4000)};
export const selectionSchema=z.discriminatedUnion('kind',[
  z.object({...common,kind:z.literal('excel'),sheet:z.string().min(1).max(150),range:z.string().max(30),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  z.object({...common,kind:z.literal('word'),storyType:z.number().int().positive(),start:z.number().int().nonnegative(),end:z.number().int().nonnegative()}).strict(),
  z.object({...common,kind:z.literal('powerpoint'),slideId:z.string().min(1).max(100),shapeIds:z.array(z.string().min(1).max(100)).min(1).max(50),textStart:z.number().int().positive().optional(),textLength:z.number().int().nonnegative().optional(),layoutRevision:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict(),
  z.object({...common,kind:z.literal('powerpoint-slides'),slideIds:z.array(z.string().min(1).max(100)).min(1).max(50)}).strict(),
]).superRefine((value,context)=>{
  if(value.kind==='powerpoint-slides'&&new Set(value.slideIds).size!==value.slideIds.length)context.addIssue({code:'custom',message:'Slide references must be unique.'});
  if(value.kind==='excel')try{rangeDimensions(value.range);}catch{context.addIssue({code:'custom',message:'Selection must be a bounded Excel range of at most 1000 cells.'});}
  if(value.kind==='word'&&value.end<value.start)context.addIssue({code:'custom',message:'Word selection end precedes start.'});
  if(value.kind==='powerpoint'&&((value.textStart===undefined)!==(value.textLength===undefined)||(value.textStart!==undefined&&value.shapeIds.length!==1)))context.addIssue({code:'custom',message:'Text selection requires one shape and paired start/length.'});
});
export type CapturedSelection=z.infer<typeof selectionSchema>;
