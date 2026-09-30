import test from 'node:test';
import assert from 'node:assert/strict';
import {importOptions} from '../packages/document-workspace/import-options.ts';
import {validateBatch} from '../packages/document-workspace/files.ts';
test('import accepts bounded sheet/cell and explicit locale settings, not file paths or injected flags',()=>{
  const good={sheet:'/Sheet1',dataFileId:'a'.repeat(36),startCell:'B2',header:true,delimiter:';',decimal:','};
  assert.deepEqual(importOptions(good),['--start-cell','B2','--header','--delimiter',';','--decimal',',']);
  for(const change of [{sheet:'C:/private'},{sheet:'/a\nb'},{dataFileId:'C:/file.csv'},{startCell:'A1:B9'},{startCell:'XFE1'},{delimiter:'--file'},{decimal:';'},{header:'true'},{commands:[]}])assert.throws(()=>importOptions({...good,...change}));
});
test('legacy dump marker is accepted only in its exact documented position and shape',()=>{
  const meta={command:'meta',dumpVersion:1},edit={command:'add',parent:'/body',type:'paragraph',props:{text:'one\ntwo'}};
  assert.equal(validateBatch([meta,edit]).length,2);
  assert.throws(()=>validateBatch([edit,meta]));assert.throws(()=>validateBatch([{...meta,execute:'shell'},edit]));assert.throws(()=>validateBatch([{...meta,dumpVersion:999},edit]));
});
