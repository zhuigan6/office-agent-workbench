import {unzipSync} from 'fflate';
import {AppError} from '../contracts/index.ts';
function parts(bytes:Buffer){
  let size=0,count=0;
  return unzipSync(bytes,{filter:entry=>{
    size+=entry.originalSize;count++;
    if(size>128*1024*1024||count>10000||entry.originalSize>32*1024*1024)throw new AppError('PACKAGE_LIMIT','Package exceeds change-inspection limits.');
    return !entry.name.endsWith('/');
  }});
}
export function packageChanges(before:Buffer|undefined,after:Buffer){
  const old=before?parts(before):{},next=parts(after),names=[...new Set([...Object.keys(old),...Object.keys(next)])].sort();
  const changes:{part:string;change:string}[]=[];let added=0,removed=0,modified=0,unchanged=0;
  for(const name of names){
    if(!Object.hasOwn(old,name)){added++;changes.push({part:name,change:'added'});}
    else if(!Object.hasOwn(next,name)){removed++;changes.push({part:name,change:'removed'});}
    else if(!Buffer.from(old[name]).equals(Buffer.from(next[name]))){modified++;changes.push({part:name,change:'modified'});}
    else unchanged++;
  }
  return {kind:'ooxml-parts',added,removed,modified,unchanged,parts:changes.slice(0,200),truncated:changes.length>200,
    note:'Package-part comparison, not visual or semantic verification. Document properties and generated IDs may change without visible content changes.'};
}
