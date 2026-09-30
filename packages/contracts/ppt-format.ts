import {z} from 'zod';
import {selectionSchema} from './selection.ts';
import {wordFontSchema} from './word-format.ts';
export const pptFormatSchema=z.object({operationId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),selection:selectionSchema,font:wordFontSchema}).strict().superRefine((v,c)=>{
  if(v.selection.kind!=='powerpoint'||v.selection.shapeIds.length!==1||(v.selection.textLength!==undefined&&v.selection.textLength<1))c.addIssue({code:'custom',message:'Select one text shape or a nonempty text range in it.'});
  if(v.font.size!==undefined&&v.font.size>400)c.addIssue({code:'custom',message:'PowerPoint font size must not exceed 400 points.'});
});
