import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { OfficeCli } from '../packages/officecli-adapter/index.ts';
import { loadConfig, root, local } from '../apps/local-host/config.ts';
const config=loadConfig(),lock=JSON.parse(await fs.readFile(path.join(root,'upstreams.lock.json'),'utf8'));
const engine=new OfficeCli(config.officecli,path.join(local,'artifacts'),lock.officecli.binarySha256);
const samples:number[]=[],outputs:string[]=[];
for(let index=0;index<3;index++){
  const start=performance.now(),result=await engine.help(['docx','set','table']);samples.push(performance.now()-start);
  if(result.code!==0)throw Error('Original pinned engine help failed.');outputs.push(result.stdout);
}
if(outputs.some(output=>output!==outputs[0]))throw Error('Cached static schema differs from upstream output.');
const report={engineVersion:lock.officecli.version,coldMilliseconds:samples[0],warmMilliseconds:samples.slice(1),identical:true,documentOperationsIssued:false,
  scope:'Repeated static help only; not a general document/task speed or billing comparison.'};
const directory=path.join(local,'verification','office-help-cache-'+Date.now());await fs.mkdir(directory,{recursive:true});
await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,evidence:directory}));
