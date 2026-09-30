import {z} from 'zod';
import {selectionSchema} from './selection.ts';
export const wordReplaceSchema=z.object({operationId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),selection:selectionSchema,text:z.string().max(2000)}).strict().superRefine((v,c)=>{
  if(v.selection.kind!=='word'||v.selection.storyType!==1||v.selection.end<=v.selection.start||v.selection.end-v.selection.start>2000)c.addIssue({code:'custom',message:'Select 1 to 2000 main-body Word characters.'});
  if(/[\u0000-\u001f\u2028\u2029]/.test(v.text))c.addIssue({code:'custom',message:'Paragraph and structural controls need a separate operation.'});
});
export interface TextSplice{start:number;end:number;text:string}
// Retain equal text in place. Word applies splices in reverse offset order.
// Code-point alignment avoids cutting UTF-16 surrogate pairs; offsets are UTF-16.
export function planTextSplices(before:string,after:string):TextSplice[]{
  if(before.length>2000||after.length>2000)throw Error('WORD_TEXT_LIMIT');
  const a=Array.from(before),b=Array.from(after),width=b.length+1;
  const table=new Uint16Array((a.length+1)*width);
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)table[i*width+j]=a[i]===b[j]?1+table[(i+1)*width+j+1]:Math.max(table[(i+1)*width+j],table[i*width+j+1]);
  const edits:TextSplice[]=[];let i=0,j=0,offset=0,current:TextSplice|undefined;
  function flush(){if(current){edits.push(current);current=undefined;}}
  while(i<a.length||j<b.length){
    if(i<a.length&&j<b.length&&a[i]===b[j]){flush();offset+=a[i++].length;j++;continue;}
    current??={start:offset,end:offset,text:''};
    if(j<b.length&&(i===a.length||table[i*width+j+1]>=table[(i+1)*width+j]))current.text+=b[j++];
    else{offset+=a[i++].length;current.end=offset;}
  }
  flush();return edits.reverse();
}
