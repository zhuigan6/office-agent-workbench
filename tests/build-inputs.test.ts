import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildInputs,assertBuildDestination} from '../packages/distribution/build-inputs.ts';
test('build destinations cannot recursively copy source or dependency trees into themselves',()=>{
  const root=path.resolve('fixture-root');
  for(const target of [root,path.join(root,'apps/new'),path.join(root,'node_modules/new'),path.join(root,'packages/new')])assert.throws(()=>assertBuildDestination(root,target));
  assert.doesNotThrow(()=>assertBuildDestination(root,path.join(root,'.local/new')));
  assert.doesNotThrow(()=>assertBuildDestination(root,path.resolve('fixture-output')));
});
test('clean build inputs need no private config and reject partial configuration or escaping resources',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-build-inputs-'));
  try{
    await fs.mkdir(path.join(root,'resources/node'),{recursive:true});await fs.writeFile(path.join(root,'resources/node/node.exe'),'fixture');
    const manifest={schemaVersion:2,runtimeKey:'win32-x64',node:{root:'node',executable:'node.exe'},clis:[]};
    await fs.writeFile(path.join(root,'resources/manifest.json'),JSON.stringify(manifest));
    const env={WORKBENCH_BUILD_AIONCORE:'core.exe',WORKBENCH_BUILD_OFFICECLI:'officecli.exe',WORKBENCH_BUILD_RESOURCES:'resources'};
    const inputs=await buildInputs(root,env);assert.deepEqual(inputs.secrets,[]);assert.equal(inputs.aioncore,path.join(root,'core.exe'));
    await assert.rejects(buildInputs(root,{WORKBENCH_BUILD_AIONCORE:'core.exe'}),/all three/);
    await fs.writeFile(path.join(root,'node.exe'),'outside');manifest.node.root='..';await fs.writeFile(path.join(root,'resources/manifest.json'),JSON.stringify(manifest));
    await assert.rejects(buildInputs(root,env),/escapes/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
