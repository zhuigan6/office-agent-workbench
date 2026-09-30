import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { OfficeCli } from '../packages/officecli-adapter/index.ts';
class Fake extends OfficeCli {
  calls = 0; fail = false;
  override async run(args: string[]) { this.calls++; await new Promise(resolve=>setTimeout(resolve,5)); return {code:this.fail?1:0,stdout:JSON.stringify(args),stderr:''}; }
}
async function fixture(run: (file:string)=>Promise<void>) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-help-cache-'));
  try{const file=path.join(dir,'fixture.bin');await fs.writeFile(file,'one');await run(file);}
  finally{await fs.rm(dir,{recursive:true,force:true});}
}
test('static engine help coalesces simultaneous reads, preserves output and isolates argument keys',()=>fixture(async file=>{
  const engine=new Fake(file,'unused');
  const results=await Promise.all([engine.help(['docx']),engine.help(['docx']),engine.help(['docx'])]);
  assert.equal(engine.calls,1);assert.deepEqual(results[0],results[2]);
  results[0].stdout='modified';assert.notEqual((await engine.help(['docx'])).stdout,'modified');
  await engine.help(['xlsx']);assert.equal(engine.calls,2);
  await assert.rejects(engine.help(['../file']));
}));
test('help cache cannot bypass pinned binary validation or survive an engine update',()=>fixture(async file=>{
  const hash=createHash('sha256').update('one').digest('hex');const pinned=new Fake(file,'unused',hash);
  await pinned.help(['docx']);await fs.writeFile(file,'changed engine content');
  await assert.rejects(pinned.help(['docx']),/differs from the pinned release/);assert.equal(pinned.calls,1);
  const unpinned=new Fake(file,'unused');await unpinned.help(['docx']);
  await fs.writeFile(file,'a longer replacement engine');await unpinned.help(['docx']);assert.equal(unpinned.calls,2);
}));
test('failed help responses are never reused as a successful capability record',()=>fixture(async file=>{
  const engine=new Fake(file,'unused');engine.fail=true;
  await engine.help(['docx']);await engine.help(['docx']);assert.equal(engine.calls,2);
  engine.fail=false;await engine.help(['docx']);await engine.help(['docx']);assert.equal(engine.calls,3);
}));
