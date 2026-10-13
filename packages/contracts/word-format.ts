import {z} from 'zod';
import {selectionSchema} from './selection.ts';

export const wordFontSchema=z.object({bold:z.boolean().optional(),italic:z.boolean().optional(),size:z.number().min(1).max(1638).multipleOf(0.5).optional()}).strict().refine(v=>Object.keys(v).length>0,'At least one font property is required.');
const wordParagraphObject=z.object({
  style:z.enum(['normal','title','subtitle','heading1','heading2','heading3','heading4','heading5','heading6']).optional(),
  alignment:z.enum(['left','center','right','justify']).optional(),
  spaceBefore:z.number().finite().min(0).max(1584).optional(),
  spaceAfter:z.number().finite().min(0).max(1584).optional(),
  leftIndent:z.number().finite().min(0).max(1584).optional(),
  rightIndent:z.number().finite().min(0).max(1584).optional(),
  firstLineIndent:z.number().finite().min(-1584).max(1584).optional(),
  keepWithNext:z.boolean().optional(),keepTogether:z.boolean().optional(),
}).strict();
export const wordParagraphSchema=wordParagraphObject.refine(v=>Object.keys(v).length>0,'At least one paragraph property is required.');
export const wordCellParagraphSchema=wordParagraphObject.omit({style:true})
  .refine(v=>Object.keys(v).length>0,'At least one cell paragraph property is required.');
export const wordFormatSchema=z.object({operationId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),selection:selectionSchema,font:wordFontSchema.optional(),paragraph:wordParagraphSchema.optional()}).strict().superRefine((value,ctx)=>{
  if(!value.font&&!value.paragraph)ctx.addIssue({code:'custom',message:'Provide font or paragraph properties.'});
  if(value.selection.kind!=='word'||value.selection.storyType!==1||value.selection.end<=value.selection.start||value.selection.end-value.selection.start>2000)ctx.addIssue({code:'custom',message:'Select 1 to 2000 main-body Word characters.'});
});
