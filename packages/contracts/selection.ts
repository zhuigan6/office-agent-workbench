import {z} from 'zod';
import {rangeDimensions} from './index.ts';
import {wordTableReferenceSchema} from './word-table.ts';
import {excelTableReferenceSchema} from './excel-table.ts';
import {excelChartReferenceSchema} from './excel-chart.ts';

const common={documentId:z.string().min(1).max(200),hostSessionId:z.string().min(1).max(200),contentHash:z.string().regex(/^[a-f0-9]{64}$/),preview:z.string().max(4000)};
export const selectionSchema=z.discriminatedUnion('kind',[
  z.object({...common,kind:z.literal('excel-chart'),chart:excelChartReferenceSchema}).strict(),
  z.object({...common,kind:z.literal('excel'),sheet:z.string().min(1).max(150),range:z.string().max(30),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/),table:excelTableReferenceSchema.optional()}).strict(),
  z.object({...common,kind:z.literal('word'),storyType:z.number().int().positive(),start:z.number().int().nonnegative(),end:z.number().int().nonnegative(),cell:z.object({tableIndex:z.number().int().min(1).max(1000),row:z.number().int().min(1).max(20),column:z.number().int().min(1).max(20)}).strict().optional(),table:wordTableReferenceSchema.optional()}).strict(),
  z.object({...common,kind:z.literal('powerpoint'),slideId:z.string().min(1).max(100),shapeIds:z.array(z.string().min(1).max(100)).min(1).max(50),textStart:z.number().int().positive().optional(),textLength:z.number().int().nonnegative().optional(),layoutRevision:z.string().regex(/^[a-f0-9]{64}$/).optional(),replacementRevision:z.string().regex(/^[a-f0-9]{64}$/).optional(),paragraphProfileVersion:z.literal(1).optional(),frameProfileVersion:z.literal(1).optional(),appearanceProfileVersion:z.literal(1).optional(),shapeLayouts:z.array(z.object({shapeId:z.string().min(1).max(100),layoutRevision:z.string().regex(/^[a-f0-9]{64}$/),contentHash:z.string().regex(/^[a-f0-9]{64}$/),frameProfileVersion:z.literal(1).optional(),appearanceProfileVersion:z.literal(1).optional(),paragraphProfileVersion:z.literal(1).optional(),replacementRevision:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict()).min(2).max(20).optional()}).strict(),
  z.object({...common,kind:z.literal('powerpoint-slides'),slideIds:z.array(z.string().min(1).max(100)).min(1).max(50)}).strict(),
]).superRefine((value,context)=>{
  if(value.kind==='excel-chart'&&(value.chart.hostSessionId!==value.hostSessionId||value.chart.revision!==value.contentHash))context.addIssue({code:'custom',message:'A chart reference must match its captured window and revision.'});
  if(value.kind==='powerpoint-slides'&&new Set(value.slideIds).size!==value.slideIds.length)context.addIssue({code:'custom',message:'Slide references must be unique.'});
  if(value.kind==='excel')try{rangeDimensions(value.range);}catch{context.addIssue({code:'custom',message:'Selection must be a bounded Excel range of at most 1000 cells.'});}
  if(value.kind==='excel'&&value.table&&(value.table.sheet!==value.sheet||value.table.range!==value.range||value.table.hostSessionId!==value.hostSessionId))context.addIssue({code:'custom',message:'A complete Excel table reference must match its captured sheet/range/window.'});
  if(value.kind==='word'&&value.end<value.start)context.addIssue({code:'custom',message:'Word selection end precedes start.'});
  if(value.kind==='word'&&value.table&&(value.cell||value.storyType!==1||value.start!==value.table.tableStart||value.hostSessionId!==value.table.hostSessionId||value.contentHash!==value.table.revision))context.addIssue({code:'custom',message:'Whole-table references must match the exact captured window, start and revision, without a cell reference.'});
  if(value.kind==='powerpoint'&&((value.textStart===undefined)!==(value.textLength===undefined)||(value.textStart!==undefined&&value.shapeIds.length!==1)))context.addIssue({code:'custom',message:'Text selection requires one shape and paired start/length.'});
  if(value.kind==='powerpoint'&&(new Set(value.shapeIds).size!==value.shapeIds.length||(value.shapeLayouts&&(value.shapeLayouts.length!==value.shapeIds.length||value.shapeLayouts.some((item,index)=>item.shapeId!==value.shapeIds[index])))))context.addIssue({code:'custom',message:'Shape snapshots must match unique selected IDs in order.'});
});
export type CapturedSelection=z.infer<typeof selectionSchema>;
