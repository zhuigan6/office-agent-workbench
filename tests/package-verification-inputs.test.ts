import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {packageVerificationScripts} from '../packages/distribution/verification-inputs.ts';
test('package allowlist includes static test helper imports and their parser fixtures',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url)),included=new Set(packageVerificationScripts);
  for(const file of await fs.readdir(path.join(root,'tests'))){
    if(!file.endsWith('.test.ts'))continue;const content=await fs.readFile(path.join(root,'tests',file),'utf8');
    for(const match of content.matchAll(/\.\.\/scripts\/([\w./-]+\.(?:ts|ps1))/g))assert.ok(included.has(match[1]),`Package omits test helper ${match[1]}`);
  }
  for(const name of packageVerificationScripts){assert.ok(!name.includes('..')&&!name.includes('\\')&&!name.startsWith('.'));assert.ok((await fs.stat(path.join(root,'scripts',name))).isFile());}
  for(const name of ['Trace-WordWidthRestore.ps1','Set-WordWidthOriginFixture.ps1','Export-WordTableWidthFixture.ps1'])assert.ok(included.has(name));
});
