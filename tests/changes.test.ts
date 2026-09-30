import {test} from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {packageChanges} from '../packages/document-workspace/changes.ts';
const zip=(v:Record<string,string>)=>Buffer.from(zipSync(Object.fromEntries(Object.entries(v).map(([k,s])=>[k,strToU8(s)]))));
test('package diff preserves identical parts and distinguishes additions, removals and modifications',()=>{
  const before=zip({'word/document.xml':'old','word/styles.xml':'same','old.xml':'removed'});
  const after=zip({'word/document.xml':'new','word/styles.xml':'same','word/media/a.png':'image'});
  const r=packageChanges(before,after);
  assert.deepEqual([r.added,r.removed,r.modified,r.unchanged],[1,1,1,1]);
  assert.equal(r.parts.length,3);assert.match(r.note,/not visual/);
  assert.equal(packageChanges(undefined,after).added,3);
  const unusual=zip({'constructor':'part data','toString':'part data'});
  assert.equal(packageChanges(undefined,unusual).added,2);
  assert.equal(packageChanges(unusual,zip({})).removed,2);
});
