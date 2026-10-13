import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {assertOriginalWorkspace} from '../packages/native-sessions/workspace-identity.ts';

test('native resume refuses vendor folder moves before mutating the original thread',()=>{
  const cwd=path.resolve('original-tests');
  assert.doesNotThrow(()=>assertOriginalWorkspace({id:'thread',cwd},'thread',cwd));
  assert.doesNotThrow(()=>assertOriginalWorkspace({id:'thread',cwd:cwd.toUpperCase()},'thread',cwd));
  if(process.platform==='win32')assert.doesNotThrow(()=>assertOriginalWorkspace({id:'thread',cwd:path.toNamespacedPath(cwd)},'thread',cwd));
  for(const thread of [null,{}, {id:'other',cwd},{id:'thread',cwd:'relative'}, {id:'thread',cwd:path.resolve('moved-tests')}])
    assert.throws(()=>assertOriginalWorkspace(thread,'thread',cwd),{code:'NATIVE_SOURCE_MISMATCH'});
});
