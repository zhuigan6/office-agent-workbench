import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sha256} from '../packages/distribution/index.ts';
import {upgradePackage,rollbackPackage} from '../packages/distribution/upgrade.ts';
test('offline upgrade and rollback preserve private data and unrelated files',async()=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-upgrade-'));
  const source=path.join(base,'package'),target=path.join(base,'installed');
  try{
    await fs.mkdir(source);await fs.mkdir(target);
    await fs.mkdir(path.join(target,'.local'));await fs.writeFile(path.join(target,'.local','chat.db'),'private history');
    const pkg=JSON.stringify({name:'office-agent-workbench'});
    await fs.writeFile(path.join(source,'package.json'),pkg);await fs.writeFile(path.join(source,'app.txt'),'new');await fs.writeFile(path.join(source,'added.txt'),'added');
    await fs.writeFile(path.join(source,'package-manifest.json'),JSON.stringify({schemaVersion:1,version:'test',files:{'package.json':sha256(Buffer.from(pkg)),'app.txt':sha256(Buffer.from('new')),'added.txt':sha256(Buffer.from('added'))}}));
    await fs.writeFile(path.join(target,'package.json'),pkg);await fs.writeFile(path.join(target,'app.txt'),'old');await fs.writeFile(path.join(target,'user.txt'),'preserved');
    const result=await upgradePackage(source,target),id=path.basename(result.backup);
    assert.equal(await fs.readFile(path.join(target,'app.txt'),'utf8'),'new');
    await fs.writeFile(path.join(target,'app.txt'),'user change');await assert.rejects(rollbackPackage(target,id),/changed after upgrade/);
    await fs.writeFile(path.join(target,'app.txt'),'new');
    // A killed process may leave the initial journal state after some renames.
    const journalPath=path.join(result.backup,'journal.json'),journal=JSON.parse(await fs.readFile(journalPath,'utf8'));
    journal.state='prepared';await fs.writeFile(journalPath,JSON.stringify(journal));
    await rollbackPackage(target,id);
    assert.equal(await fs.readFile(path.join(target,'app.txt'),'utf8'),'old');assert.equal(await fs.readFile(path.join(target,'user.txt'),'utf8'),'preserved');
    assert.equal(await fs.readFile(path.join(target,'.local','chat.db'),'utf8'),'private history');
    await assert.rejects(fs.access(path.join(target,'added.txt')));await assert.rejects(rollbackPackage(target,'../../escape'));
    assert.equal((await fs.readdir(target)).some(name=>name.includes('.upgrade-')),false);
  }finally{await fs.rm(base,{recursive:true,force:true});}
});
