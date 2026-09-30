import test from 'node:test';
import assert from 'node:assert/strict';
import {hostTextReadSchema,hostTextWriteSchema,assertPlainParagraph,textState} from '../packages/contracts/host-text.ts';
test('text tools reject unbounded pages and structural paragraph writes',()=>{
  assert.throws(()=>hostTextReadSchema.parse({count:5000}));assert.throws(()=>hostTextReadSchema.parse({shapeId:'s'}));
  assert.throws(()=>hostTextWriteSchema.parse({target:{kind:'word',paragraphId:'p'},expectedRevision:'a'.repeat(64),text:'one\ntwo'}));
  assert.throws(()=>assertPlainParagraph('<w:p><w:drawing/></w:p>'));assert.doesNotThrow(()=>assertPlainParagraph('<w:p><w:r><w:t>plain</w:t></w:r></w:p>'));
});
test('text revisions include session, target and rich-content hash',async()=>{
  const initial={target:{kind:'word' as const,paragraphId:'p'},sessionId:'one',text:'Hello',contentHash:'x'};
  const a=await textState(initial);assert.equal((await textState(initial)).revision,a.revision);
  assert.notEqual((await textState({...initial,sessionId:'two'})).revision,a.revision);
  assert.notEqual((await textState({...initial,contentHash:'y'})).revision,a.revision);
});
test('paragraph semantic comparison is separate from the guarded write revision',async()=>{
  const initial={target:{kind:'word' as const,paragraphId:'1'},sessionId:'worker',text:'neighbor',contentHash:'guarded',semanticHash:'a'.repeat(64)};
  const first=await textState(initial);assert.equal(first.semanticHash,initial.semanticHash);
  const otherPosition=await textState({...initial,contentHash:'changed-body-or-position'});
  assert.equal(otherPosition.semanticHash,first.semanticHash);assert.notEqual(otherPosition.revision,first.revision);
  assert.equal((await textState({...initial,semanticHash:'b'.repeat(64)})).revision,first.revision);
  await assert.rejects(textState({...initial,semanticHash:'invalid'}),{code:'TEXT_STATE'});
});
