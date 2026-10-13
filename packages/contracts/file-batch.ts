import {AppError} from './index.ts';
import {boundedInspection} from './inspection-output.ts';
export function batchEvidence(execution:any){
  const data=execution?.output?.data,summary=data?.summary,rows=data?.results;
  if(!summary||!Array.isArray(rows)||!Array.isArray(execution.commands))return undefined;
  const counts:Record<string,number>={};
  for(const key of ['total','executed','succeeded','failed','skipped']){const n=summary[key];if(!Number.isInteger(n)||n<0||n>500)return undefined;counts[key]=n;}
  let commands:string[]=execution.commands;
  if(commands[0]==='meta'&&counts.total===commands.length-1)commands=commands.slice(1);
  const seen=new Set<number>(),matched=counts.total===commands.length&&rows.length<=500&&rows.every((r:any)=>Number.isInteger(r.index)&&r.index>=0&&r.index<commands.length&&!seen.has(r.index)&&Boolean(seen.add(r.index))&&typeof r.success==='boolean');
  const failures=rows.filter((r:any)=>r.success===false),readRows=matched?rows.filter((r:any)=>r.success&&['get','query','raw','dump'].includes(commands[r.index])):[];
  const reads:any[]=[];let omitted=0,partial=false;
  for(const row of readRows){
    const budget=8000-JSON.stringify(reads).length-512;
    if(budget<1000||row.output===undefined){omitted++;continue;}
    const value=Array.isArray(row.output?.results)?{data:row.output}:row.output;
    const bounded=boundedInspection(value,budget);reads.push({index:row.index,command:commands[row.index],...bounded});partial||=bounded.truncated;
  }
  return {exitCode:execution.exitCode,summary:counts,commandSchemaMatched:matched,
    ...(typeof summary.atomicRolledBack==='boolean'?{upstreamReportedRollback:summary.atomicRolledBack}:{}),
    failedSteps:failures.slice(0,10).map((r:any)=>({index:Number.isInteger(r.index)&&r.index>=0&&r.index<500?r.index:undefined,code:typeof r.code==='string'?r.code.slice(0,80):undefined,error:typeof r.error==='string'?r.error.slice(0,400):'Command failed.'})),omittedFailureSteps:Math.max(0,failures.length-10),
    readResultCount:readRows.length,readResults:reads,omittedReadResults:omitted,readResultsTruncated:partial||omitted>0,
    readState:'Observed when each command ran in the staged batch; not necessarily the final published copy.',detailsRetainedInLocalJournal:true};
}
export class FileBatchError extends AppError{
  constructor(public receipt:Record<string,unknown>,code='BATCH_FAILED',status=422){super(code,'Batch did not publish a new copy. Inspect the recorded outcome; do not blindly resend.',status);}
}
