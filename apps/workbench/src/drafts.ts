import type {FileRecord} from './Product.tsx';

export interface Draft {content:string; attachments:FileRecord[]}
export type Drafts = Record<string,Draft>;
export const draftKey='workbench.tab-drafts.v1';
export const emptyDraft=():Draft=>({content:'',attachments:[]});

export function readDrafts(storage:Pick<Storage,'getItem'>):Drafts {
  try {
    const value=JSON.parse(storage.getItem(draftKey) || '{}');
    if(!value||typeof value!=='object'||Array.isArray(value))return {};
    const result:Drafts={};
    for(const [id,draft] of Object.entries(value) as [string,any][]){
      if(!/^[\w-]{1,100}$/.test(id)||id==='__proto__'||!draft||typeof draft.content!=='string'||!Array.isArray(draft.attachments))continue;
      result[id]={content:draft.content,attachments:draft.attachments.filter((f:any)=>f&&typeof f.id==='string'&&typeof f.name==='string')};
    }
    return result;
  } catch {return {};}
}

// Only acknowledge the submitted draft, never discard text typed while awaiting a reply.
export function acknowledgeDraft(current:Draft,submitted:Draft):Draft {
  const sent=new Set(submitted.attachments.map(f=>f.id));
  return {content:current.content===submitted.content?'':current.content,attachments:current.attachments.filter(f=>!sent.has(f.id))};
}
