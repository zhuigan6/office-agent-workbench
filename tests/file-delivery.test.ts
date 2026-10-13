import test from 'node:test';
import assert from 'node:assert/strict';
import {syncTaskFileRefs} from '../packages/document-workspace/file-delivery.ts';
test('parent/native file references share exact IDs in both directions without copying bytes or touching other scopes',()=>{
  const refs=new Map<string,Set<string>>([['parent',new Set(['upload'])],['native',new Set(['upload','generated'])],['unrelated',new Set(['private'])]]);
  const workspace={list:(scope:string)=>[...(refs.get(scope)??[])].map(id=>({id})),attach:(scope:string,id:string)=>{if(!refs.has(scope))refs.set(scope,new Set());refs.get(scope)!.add(id);}};
  syncTaskFileRefs(workspace as any,'parent','native');syncTaskFileRefs(workspace as any,'parent','native');
  assert.deepEqual([...refs.get('parent')!],['upload','generated']);assert.deepEqual([...refs.get('native')!],['upload','generated']);assert.deepEqual([...refs.get('unrelated')!],['private']);
});
