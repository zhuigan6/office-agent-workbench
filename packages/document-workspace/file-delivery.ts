import type {FileWorkspace} from './files.ts';
// Call only after verifying the native link's original parent-task binding.
export function syncTaskFileRefs(files:FileWorkspace,parentTask:string,nativeScope:string){
  for(const file of files.list(parentTask))files.attach(nativeScope,file.id);
  for(const file of files.list(nativeScope))files.attach(parentTask,file.id);
}
