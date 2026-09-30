import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {safeRelative,sha256,verifyPackage} from '../packages/distribution/index.ts';

test('package paths reject private directories and traversal',()=>{
  for(const name of ['../x','/x','C:/x','a\\b','.local/config.json','a/.env','a//b','a/./b'])assert.throws(()=>safeRelative(name));
  assert.equal(safeRelative('apps/local-host/main.ts'),'apps/local-host/main.ts');
});
test('package verifies every byte and rejects extra files',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-package-'));
  try{
    await fs.writeFile(path.join(root,'app.txt'),'original');
    await fs.writeFile(path.join(root,'package-manifest.json'),JSON.stringify({schemaVersion:1,version:'test',files:{'app.txt':sha256(Buffer.from('original'))}}));
    await verifyPackage(root);
    await fs.writeFile(path.join(root,'app.txt'),'tampered');await assert.rejects(verifyPackage(root),/checksum/);
    await fs.writeFile(path.join(root,'app.txt'),'original');await fs.writeFile(path.join(root,'extra'),'unknown');
    await assert.rejects(verifyPackage(root),/unexpected/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
