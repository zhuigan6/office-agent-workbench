import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {claudeEntrypointShape,scopedClaudeInventory} from '../packages/native-sessions/claude-runtime.ts';

const workspace=path.resolve('owned-workspace'),id='861dc640-7de1-4e65-a169-35b64b579540';
const row={cwd:workspace,kind:'background',startedAt:1000,id:'861dc640',sessionId:id,state:'blocked',status:'waiting',pid:123};
test('Claude entrypoint shape probes distinguish older CLI help from new public inventory without version guessing',()=>{
  const shape=claudeEntrypointShape('  --bg, --background  Start','Usage: claude agents [options]\n  --json List\n  --cwd <path> Filter','Usage: claude attach <id|name>');
  assert.equal(shape.background,true);assert.equal(shape.scopedInventory,true);assert.equal(shape.nativeAttach,true);assert.equal(shape.sharedTransportVerified,false);
  assert.equal(claudeEntrypointShape('future version','Configured subagents: --json --cwd','Usage: claude [options]').scopedInventory,false);
});
test('Claude status is scoped metadata, not transcript, ownership or complete native sharing evidence',()=>{
  const result=scopedClaudeInventory(JSON.stringify([{...row,name:'sensitive title',token:'secret',extra:{history:'private'}}]),workspace)[0];
  assert.equal(result.nativeAttachCandidate,true);assert.equal(result.executionOwnershipVerified,false);assert.equal(result.sessionId,id);
  assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!JSON.stringify(result).includes('sensitive'));
  assert.deepEqual(scopedClaudeInventory('[]',workspace),[]);
  assert.equal(scopedClaudeInventory(JSON.stringify([{...row,kind:'interactive'}]),workspace)[0].nativeAttachCandidate,false);
});
test('unknown, malformed and foreign Claude inventories fail without selecting a similar session',()=>{
  for(const output of ['{}','not JSON',JSON.stringify([{...row,cwd:path.resolve('foreign')}]),JSON.stringify([{...row,kind:'future'}]),JSON.stringify([{...row,startedAt:null}])])assert.throws(()=>scopedClaudeInventory(output,workspace));
  assert.throws(()=>scopedClaudeInventory(' '.repeat(128*1024+1),workspace));
  const changed=scopedClaudeInventory(JSON.stringify([{...row,sessionId:'not-a-session-id',id:'different',state:'new-state',pid:-1}]),workspace)[0];
  assert.equal(changed.nativeAttachCandidate,false);assert.equal(changed.state,null);assert.equal(changed.pid,null);
});
