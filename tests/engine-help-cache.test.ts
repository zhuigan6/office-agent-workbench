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

test('equal-sized same-timestamp replacement cannot reuse help or bypass a pin',async t=>{
  let bytes=Buffer.from('one'),inode=1n;const hash=createHash('sha256').update(bytes).digest('hex');
  t.mock.method(fs,'realpath',async()=>'/simulated/engine');t.mock.method(fs,'stat',async()=>({dev:1n,ino:inode,size:3n,mtimeNs:10n,ctimeNs:10n,birthtimeNs:1n}));t.mock.method(fs,'readFile',async()=>bytes);
  const pinned=new Fake('engine','unused',hash),unpinned=new Fake('engine','unused');await pinned.help(['docx']);await unpinned.help(['docx']);bytes=Buffer.from('two');inode=2n;
  await assert.rejects(pinned.help(['docx']),/differs from the pinned release/);assert.equal(pinned.calls,1);await unpinned.help(['docx']);assert.equal(unpinned.calls,2);
  const upgraded=new Fake('engine','unused',createHash('sha256').update(bytes).digest('hex'));assert.equal((await upgraded.help(['docx'])).code,0);assert.equal(upgraded.calls,1);
});
test('metadata-only changes during help retain the same verified content identity',async t=>{
  let time=10n,reads=0;const bytes=Buffer.from('one'),hash=createHash('sha256').update(bytes).digest('hex');
  t.mock.method(fs,'realpath',async()=>'/simulated/engine');t.mock.method(fs,'stat',async()=>({dev:1n,ino:1n,size:3n,mtimeNs:time,ctimeNs:time,birthtimeNs:1n}));t.mock.method(fs,'readFile',async()=>{reads++;return bytes;});
  const engine=new Fake('engine','unused',hash);t.mock.method(engine,'run',async()=>{engine.calls++;time++;return {stdout:'same engine help',stderr:'',code:0};});
  assert.equal((await engine.help(['docx'])).stdout,'same engine help');assert.equal((await engine.help(['docx'])).stdout,'same engine help');assert.equal(engine.calls,1);assert.equal(reads,2);
});
test('engine identity changing during hashing is refused rather than cached',async t=>{
  let inode=1n;t.mock.method(fs,'realpath',async()=>'/simulated/engine');t.mock.method(fs,'stat',async()=>({dev:1n,ino:inode,size:3n,mtimeNs:10n,ctimeNs:10n,birthtimeNs:1n}));t.mock.method(fs,'readFile',async()=>{inode++;return Buffer.from('one');});
  const engine=new Fake('engine','unused');await assert.rejects(engine.help(['docx']),/changed while its content was being verified/);assert.equal(engine.calls,0);
});
