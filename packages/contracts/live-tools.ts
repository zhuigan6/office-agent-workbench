import {z} from 'zod';
import {AppError} from './index.ts';

const operations={
  target:{route:'/tools/target',kinds:['word','excel','powerpoint'],capability:'',summary:'Locate an explicit target and return a frozen selectionId; ambiguity requires user intent.',examples:{word:{kind:'word',text:'Exact paragraph text'},excel:{kind:'excel',sheet:'Sheet1',range:'A1:B2'},powerpoint:{kind:'powerpoint',slideIndex:1,shapeId:'2'}}},
  'read-range':{route:'/tools/read',kinds:['excel'],capability:'read',summary:'Read up to1000 live cells with values, formulas, formats and a revision.',example:{sheet:'Sheet1',range:'A1:B2'}},
  'read-text':{route:'/tools/read-text',kinds:['word','powerpoint'],capability:'readText',summary:'Read bounded live paragraphs or slide/shape text; lists stable IDs and revisions.',example:{start:0,count:10}},
  shapes:{route:'/tools/shapes',kinds:['powerpoint'],capability:'readText',summary:'Read bounded shape IDs, text previews and geometry on one slide.',example:{slideId:'256',start:0,count:20}},
  'write-selection':{route:'/tools/write-selection',kinds:['excel'],capability:'write',summary:'Edit only the frozen selection using exact-size matrices; never retarget.',example:{selectionId:'<frozen-reference>',operationId:'edit1',values:[[10]],numberFormat:[['0.00']]}},
  'write-range':{route:'/tools/write',kinds:['excel'],capability:'write',summary:'Edit an explicit range using its read revision; unavailable while a selected-message lock is active.',example:{sheet:'Sheet1',range:'A1',expectedRevision:'<read-revision>',operationId:'edit1',formulas:[['=SUM(B1:B3)']]}},
  'format-selection':{route:'/tools/format-selection',kinds:['word','powerpoint'],capability:'writeText',summary:'Combine font properties; Word also permits paragraph properties on complete paragraphs only. Keeps text, with guarded recovery.',examples:{word:{selectionId:'<frozen-reference>',operationId:'edit1',font:{bold:true,size:14},paragraph:{alignment:'center',spaceAfter:12,keepWithNext:true}},powerpoint:{selectionId:'<frozen-reference>',operationId:'edit1',font:{size:24}}},details:'Font: bold/italic booleans, size points (Word1..1638; PPT1..400; half-point increments). Word paragraph: alignment left/center/right/justify; spaceBefore/spaceAfter/leftIndent/rightIndent0..1584pt; firstLineIndent-1584..1584pt; keepWithNext/keepTogether booleans. At most2000 characters/20 complete main-body paragraphs. No partial expansion, lists, tables, fields, tracked/protected or embedded content.'},
  'replace-selection':{route:'/tools/replace-selection',kinds:['word'],capability:'writeText',summary:'Replace up to2000 selected characters in one plain body paragraph, preserving unchanged spans; no structural or embedded content.',example:{selectionId:'<frozen-reference>',operationId:'edit1',text:'Revised text'}},
  'layout-selection':{route:'/tools/layout-selection',kinds:['powerpoint'],capability:'writeText',summary:'Set one frozen nongroup shape geometry with layout revision; preserve its aspect-ratio constraint.',example:{selectionId:'<frozen-reference>',operationId:'edit1',geometry:{left:72,top:100}},details:'geometry supports left/top (-10000..10000pt), width/height (1..10000pt), rotation(0..360 degrees).'},
  'write-text':{route:'/tools/write-text',kinds:['word','powerpoint'],capability:'writeText',summary:'Replace one explicitly read text target with expectedRevision; rich content may be refused. Not a substitute for a locked selected edit.',examples:{word:{target:{kind:'word',paragraphId:'1'},expectedRevision:'<read-revision>',operationId:'edit1',text:'New paragraph text'},powerpoint:{target:{kind:'powerpoint',slideId:'256',shapeId:'2'},expectedRevision:'<read-revision>',operationId:'edit1',text:'New shape text'}}},
} as const;
export type LiveScope={kind:string;capabilities:string[]};
export const liveRequestShape={action:z.enum(['help','execute']),operation:z.string().min(1).max(40).optional(),params:z.record(z.unknown()).optional()};
const requestSchema=z.object(liveRequestShape).strict().superRefine((v,c)=>{
  if(v.action==='execute'&&!v.operation)c.addIssue({code:'custom',message:'Execution requires an operation.'});
  if(v.action==='help'&&v.params&&Object.keys(v.params).length)c.addIssue({code:'custom',message:'Help does not accept execution parameters.'});
});
function permitted(scope:LiveScope,name:string){
  if(!Object.hasOwn(operations,name))throw new AppError('LIVE_OPERATION_UNKNOWN','Query help for supported operations.');
  const entry=operations[name as keyof typeof operations];
  if(!(entry.kinds as readonly string[]).includes(scope.kind)||(entry.capability&&!scope.capabilities.includes(entry.capability)))
    throw new AppError('LIVE_OPERATION_UNAVAILABLE','Operation is unavailable for this bound document.',403);
  return entry;
}
export function planLiveRequest(scope:LiveScope,input:unknown):{help:unknown}|{route:string;params:Record<string,unknown>}{
  const request=requestSchema.parse(input);
  if(request.action==='execute')return {route:permitted(scope,request.operation!).route,params:request.params??{}};
  if(!request.operation)return {help:{kind:scope.kind,operations:Object.entries(operations).filter(([,v])=>(v.kinds as readonly string[]).includes(scope.kind)&&(!v.capability||scope.capabilities.includes(v.capability))).map(([operation,v])=>({operation,summary:v.summary})),instructions:'Query help with an operation for parameters/examples. Execute one operation with params. Use frozen selection IDs from the user message. Conflict/unknown: inspect and stop, never blindly retry. File-copy tasks use office_file; they are not live edits.'}};
  const entry=permitted(scope,request.operation) as any;
  const example=entry.examples?.[scope.kind]??entry.example;
  return {help:{operation:request.operation,summary:entry.summary,...(entry.details?{details:entry.details}:{}),example:{action:'execute',operation:request.operation,params:example},execution:'One existing scoped handler; no shell, arbitrary COM, inferred permission or hidden batch rollback.'}};
}
