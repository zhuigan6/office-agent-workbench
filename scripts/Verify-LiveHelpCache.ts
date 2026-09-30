import fs from 'node:fs/promises';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WorkbenchClient } from '../packages/client/index.ts';
import { loadConfig, local } from '../apps/local-host/config.ts';
const config=loadConfig(),ca=new X509Certificate(await fs.readFile(path.join(local,'server.cer'))).toString();
const client=new WorkbenchClient({port:config.port,token:config.uiToken,ca});
const outputs:string[]=[],milliseconds:number[]=[];
for(let index=0;index<3;index++){
  const start=performance.now();outputs.push(JSON.stringify(await client.file({action:'help',format:'docx',args:['set','table']})));milliseconds.push(performance.now()-start);
}
if(outputs.some(output=>output!==outputs[0]))throw Error('Live cached help differs from the first response.');
const report={sameOutput:true,milliseconds,documentWrites:0,modelRequests:0,scope:'Live local API static help only.'};
const directory=path.join(local,'verification','live-help-cache-'+Date.now());await fs.mkdir(directory,{recursive:true});
await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,evidence:directory}));
