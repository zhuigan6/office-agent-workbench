import {batchEvidence} from './file-batch.ts';
export function fileToolResult(action:string,result:any){
  if(!['create','batch','merge','import'].includes(action))return result;
  const data=result.validation?.result?.data;
  const batch=batchEvidence(result.execution);
  return {file:result.file,status:result.status,...(result.delivery?{delivery:result.delivery}:{}),...(batch?{batch}:{}),...(result.changes?{changes:{added:result.changes.added,removed:result.changes.removed,modified:result.changes.modified,unchanged:result.changes.unchanged,kind:'ooxml-parts-not-visual-diff'}}:{}),validation:{exitCode:result.validation?.exitCode,
    errorCount:typeof data?.count==='number'?data.count:null,
    errors:Array.isArray(data?.errors)?data.errors.slice(0,5):[],
    detailsRetainedInLocalJournal:true},
    next:'Inspect the returned fileId to verify requested content. This is a new copy, not a live Office edit.'};
}
