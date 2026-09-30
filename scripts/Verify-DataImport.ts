import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {root,loadConfig} from '../apps/local-host/config.ts';
import {Store} from '../packages/document-workspace/store.ts';
import {FileWorkspace} from '../packages/document-workspace/files.ts';
import {OfficeCli} from '../packages/officecli-adapter/index.ts';
const output=path.join(root,'.local/verification','data-import-'+Date.now());await fs.mkdir(output,{recursive:true});
const lock=JSON.parse(await fs.readFile(path.join(root,'upstreams.lock.json'),'utf8'));
const store=new Store(':memory:'),engine=new OfficeCli(process.env.WORKBENCH_OFFICECLI||loadConfig().officecli,output,lock.officecli.binarySha256),files=new FileWorkspace(store,output,engine);
const reports=[];
try{
  const original=await files.command({action:'create',format:'xlsx',operationId:'blank'},'test');const before=await fs.readFile(files.filename(original.file.id));
  const cases=[{name:'normal.csv',text:'Region,Amount\nNorth,120',options:{},value:'120'},
    {name:'tab.tsv',text:'Region\tAmount\nNorth\t42',options:{},value:'42'},
    {name:'decimal.csv',text:'Region;Amount\nNorth;1.234,5',options:{delimiter:';',decimal:','},value:'1234.5'},
    {name:'literal.csv',text:'Region,Amount\nNorth,=1+1',options:{},value:'=1+1'}];
  for(const scenario of cases){
    const asset=await files.put(scenario.name,Buffer.from(scenario.text));files.attach('test',asset.id);
    if(scenario.name==='literal.csv'){
      await assert.rejects(files.command({action:'import',fileId:original.file.id,dataFileId:asset.id,sheet:'/Sheet1',operationId:'literal-formula-refused'},'test'),{code:'CSV_LITERAL_REQUIRED'});
      assert.deepEqual(await fs.readFile(files.filename(original.file.id)),before);reports.push({case:scenario.name,formulaRejectedBeforeExecution:true,originalsPreserved:true});continue;
    }
    const result=await files.command({action:'import',fileId:original.file.id,dataFileId:asset.id,sheet:'/Sheet1',header:true,operationId:scenario.name.replace('.','-'),...scenario.options},'test');
    assert.equal(result.validation.exitCode,0);
    const read=await files.command({action:'inspect',fileId:result.file.id,command:'get',args:['/Sheet1/B2']},'test');assert.ok(JSON.stringify(read.output).includes(scenario.value));
    assert.deepEqual(await fs.readFile(files.filename(original.file.id)),before);assert.equal(await fs.readFile(files.filename(asset.id),'utf8'),scenario.text);
    reports.push({case:scenario.name,expectedValue:scenario.value,validated:true,originalsPreserved:true});
  }
  const paragraph={command:'add',parent:'/body',type:'paragraph',props:{text:'one\ntwo'}};
  const legacy=await files.command({action:'create',format:'docx',operationId:'legacy-lines',commands:[{command:'meta',dumpVersion:1},paragraph]});
  const modern=await files.command({action:'create',format:'docx',operationId:'modern-lines',commands:[paragraph]});
  const legacyXml=strFromU8(unzipSync(await fs.readFile(files.filename(legacy.file.id)))['word/document.xml']);
  const modernXml=strFromU8(unzipSync(await fs.readFile(files.filename(modern.file.id)))['word/document.xml']);
  const paragraphs=(xml:string)=>(xml.match(/<(?:\w+:)?p(?:\s|>)/g)||[]).length;
  assert.equal(paragraphs(modernXml),paragraphs(legacyXml)+1);assert.match(legacyXml,/<(?:\w+:)?br(?:\s|\/|>)/);
  reports.push({case:'legacy-newline',validated:true,legacyLineBreakAndModernParagraphSplit:true});
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({reports},null,2));console.log(JSON.stringify({passed:true,output,reports}));
}finally{store.close();}
