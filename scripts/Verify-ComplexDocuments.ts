import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Store} from '../packages/document-workspace/store.ts';
import {FileWorkspace} from '../packages/document-workspace/files.ts';
import {OfficeCli} from '../packages/officecli-adapter/index.ts';
import {root,loadConfig} from '../apps/local-host/config.ts';
import {assetProperty} from '../packages/document-workspace/assets.ts';
import {fileToolResult} from '../packages/contracts/file-results.ts';
import {selectedHelp} from '../packages/contracts/file-help.ts';
const binary=process.env.WORKBENCH_OFFICECLI || loadConfig().officecli,lock=JSON.parse(await fs.readFile(path.join(root,'upstreams.lock.json'),'utf8'));
await fs.mkdir(path.join(root,'.local','verification'),{recursive:true});
const output=path.join(root,'.local','verification','complex-'+Date.now());await fs.mkdir(output,{recursive:false});
const store=new Store(':memory:'),engine=new OfficeCli(binary,output,lock.officecli.binarySha256),files=new FileWorkspace(store,output,engine);
const asset=await files.put('synthetic.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
const cases:any[]=[
 {format:'docx',commands:[
  {command:'add',parent:'/styles',type:'style',props:{id:'ReportTitle',name:'Report Title',basedOn:'Normal',size:'20',bold:'true',color:'174E43'}},
  {command:'add',parent:'/body',type:'paragraph',props:{text:'Quarterly report',style:'ReportTitle'}},
  {command:'add',parent:'/body',type:'paragraph',props:{text:'Editable body and table remain structured.'}},
  {command:'add',parent:'/body',type:'table',props:{data:'Region,Sales;North,120;South,180',width:'9000',colWidths:'4500,4500',layout:'fixed'}},
 ],checks:[{command:'get',args:['/body'],includes:['Quarterly report']},{command:'get',args:['/body/tbl[1]','--depth','4'],includes:['North','180'],rows:'3',cols:'2'},
  {command:'query',args:['paragraph[style=ReportTitle] > run'],includes:['Quarterly report']}]},
 {format:'xlsx',commands:[
  {command:'add',parent:'/',type:'sheet',props:{name:'Data'}},
  {command:'set',path:'/Data/A1',props:{value:'10'}},
  {command:'set',path:'/Data/A2',props:{value:'20'}},
  {command:'set',path:'/Sheet1/A1',props:{formula:'SUM(Data!A1:A2)',numberformat:'0.00'}},
  {command:'add',parent:'/Sheet1',type:'chart',props:{chartType:'column',title:'Sales',data:'Sales:10,20',categories:'North,South',x:'3',y:'1',width:'12cm',height:'7cm'}},
 ],checks:[{command:'get',args:['/Sheet1/A1'],includes:['SUM(Data!A1:A2)'],computed:'30'},{command:'get',args:['/Sheet1/chart[1]'],includes:['Sales']}]},
 {format:'pptx',commands:[
  {command:'add',parent:'/',type:'slide',props:{title:'Overview',text:'Editable presentation',background:'#F6F5EF'}},
  {command:'add',parent:'/',type:'slide',props:{title:'Results',text:'Two-page deck',background:'#174E43'}},
  {command:'add',parent:'/slide[2]',type:'shape',props:{text:'Revenue 300',x:'2cm',y:'4cm',width:'10cm',height:'2cm',size:'28',color:'FFFFFF'}},
  {command:'add',parent:'/slide[2]',type:'picture',props:{src:'asset:'+asset.id,x:'16cm',y:'4cm',width:'2cm',height:'2cm'}},
 ],checks:[{command:'get',args:['/slide[2]'],includes:['Revenue 300','picture']}]},
];
const reports:any[]=[];
const repetitions=Number(process.env.WORKBENCH_BENCHMARK_REPEATS||'1');
if(!Number.isSafeInteger(repetitions)||repetitions<1||repetitions>10)throw Error('WORKBENCH_BENCHMARK_REPEATS must be 1 to 10.');
try{
 for(let repetition=0;repetition<repetitions;repetition++){
 for(const scenario of cases){
  const runDirect=async()=>{
  const baselineFile=path.join(output,`direct-baseline-${repetition}.${scenario.format}`),baselineStart=performance.now();
  const directCommands=structuredClone(scenario.commands);
  for(const command of directCommands)for(const [key,value] of Object.entries(command.props||{})){const ref=assetProperty(key,value);if(ref)command.props[key]=ref.prefix+files.filename(ref.id);}
  assert.equal((await engine.run(['create',baselineFile,'--json'])).code,0);
  const directBatch=await engine.run(['batch',baselineFile,'--json'],JSON.stringify(directCommands));assert.equal(directBatch.code,0);assert.notEqual(JSON.parse(directBatch.stdout).success,false);
  assert.equal((await engine.run(['validate',baselineFile,'--json'])).code,0);
  for(const check of scenario.checks){const read=await engine.run([check.command,baselineFile,...check.args,'--json']);assert.equal(read.code,0);for(const value of check.includes)assert.ok(read.stdout.includes(value));const format=JSON.parse(read.stdout).data.results[0].format;if(check.rows){assert.equal(format.rows,check.rows);assert.equal(format.cols,check.cols);}if(check.computed)assert.equal(format.computedValue,check.computed);}
  assert.equal((await engine.run(['view',baselineFile,'html'])).code,0);
  const directMilliseconds=Math.round(performance.now()-baselineStart);
  return {directMilliseconds,directBatchResponseBytes:Buffer.byteLength(directBatch.stdout)};
  };
  const runWorkbench=async()=>{
  const started=performance.now();
  const result=await files.command({action:'create',format:scenario.format,operationId:`complex-${scenario.format}-${repetition}`,commands:scenario.commands});
  assert.equal(result.validation.exitCode,0,JSON.stringify(result.validation));
  for(const check of scenario.checks){const read=await files.command({action:'inspect',fileId:result.file.id,command:check.command,args:check.args});const text=JSON.stringify(read.output);for(const value of check.includes)assert.ok(text.includes(value),`Missing ${value} in ${scenario.format} readback`);if(check.rows){assert.equal(read.output.data.results[0].format.rows,check.rows);assert.equal(read.output.data.results[0].format.cols,check.cols);}if(check.computed)assert.equal(read.output.data.results[0].format.computedValue,check.computed);}
  const preview=await files.command({action:'preview',fileId:result.file.id});assert.ok(preview.output.includes('<'));
  await fs.copyFile(files.filename(result.file.id),path.join(output,'complex.'+scenario.format));
  return {milliseconds:Math.round(performance.now()-started),workbenchReceiptBytes:Buffer.byteLength(JSON.stringify(fileToolResult('create',result))),file:result.file};
  };
  let direct,workbench;
  if(repetition%2===0){direct=await runDirect();workbench=await runWorkbench();}
  else{workbench=await runWorkbench();direct=await runDirect();}
  reports.push({format:scenario.format,repetition,order:repetition%2===0?'direct-first':'workbench-first',validated:true,readback:true,htmlPreview:true,...direct,...workbench});
 }
 }
 const help=await engine.run(['help','docx','table','--json']);
 const helpBytes={full:Buffer.byteLength(help.stdout),selected:Buffer.byteLength(JSON.stringify(selectedHelp(help.stdout,['data','rows','cols'])))};
 const note='Paired deterministic engine workflow, not an LLM benchmark. No token or billing savings inferred from byte sizes. Same pinned engine, command plans, validation/readback/HTML checks; paired order alternates when repeated. Timings include process launch and cache effects.';
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({officecli:lock.officecli.version,note,helpBytes,reports},null,2));
 console.log(JSON.stringify({passed:true,output,note,helpBytes,reports:reports.map(({file,...r})=>r)}));
}finally{store.close();}
