import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {Operation} from '../packages/contracts/index.ts';
import {nativeOperations,assertNativeOperation,unresolvedNativeOperations} from '../packages/native-sessions/operations.ts';

test('native operation history includes only this scope and document, with actual recovery status',()=>{
  const link='00000000-0000-0000-0000-000000000001',id=link.slice(0,32)+'_edit';
  const make=(id:string,documentId='doc',status:Operation['status']='applied'):Operation=>({id,documentId,status,kind:'word.format',payload:{},result:{},createdAt:1,updatedAt:1});
  const recovered=make('restore_'+createHash('sha256').update(JSON.stringify(id)).digest('hex').slice(0,48));
  const ops=[make(id),make(id,'other'),make('foreign_edit'),recovered];
  const found=nativeOperations(ops,link,'doc');
  assert.equal(found.length,1);assert.equal(found[0].recovery?.status,'applied');
  assert.equal(assertNativeOperation(ops,link,'doc',id).id,id);
  assert.throws(()=>assertNativeOperation(ops,link,'other','foreign_edit'),{code:'NATIVE_OPERATION_SCOPE'});
  assert.equal(nativeOperations([make(id)],link,'doc')[0].recovery,null);
  assert.deepEqual(unresolvedNativeOperations(ops,link,'doc'),[]);
  assert.deepEqual(unresolvedNativeOperations([...ops.filter(op=>op.id!==recovered.id),{...recovered,status:'unknown'}],link,'doc'),[recovered.id]);
  recovered.result={layoutDeclarationsNormalized:true};
  assert.equal(nativeOperations(ops,link,'doc')[0].recovery?.layoutDeclarationsNormalized,true);
});
