import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {unzipSync,strFromU8} from 'fflate';
const namespace='http://schemas.microsoft.com/office/2006/xmlPackage';
const part=(name:string,data:string)=>`<pkg:part pkg:name="${name}" pkg:contentType="application/xml"><pkg:xmlData>${data}</pkg:xmlData></pkg:part>`;
const base=part('/_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')+part('/word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>unsaved marker</w:t></w:r></w:p></w:body></w:document>');
const pack=(parts:string)=>`<pkg:package xmlns:pkg="${namespace}">${parts}</pkg:package>`;
const root=fileURLToPath(new URL('../',import.meta.url)),shell=path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
function run(xml:string,directory:string,name:string){const input=path.join(directory,name+'.xml'),output=path.join(directory,name+'.docx');fs.writeFileSync(input,xml);const result=spawnSync(shell,['-NoProfile','-NonInteractive','-File',path.join(root,'tests/export-word-flat.ps1'),'-InputFile',input,'-Destination',output],{encoding:'utf8',windowsHide:true,timeout:15000});return {result,output};}
test('Word flat package preserves XML namespaces, binary bytes and content types',{skip:process.platform!=='win32'},()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-flat-'));
  const binary='<pkg:part pkg:name="/word/media/image.bin" pkg:contentType="application/octet-stream"><pkg:binaryData>AAH/</pkg:binaryData></pkg:part>';
  const {result,output}=run(pack(base+binary),directory,'valid');assert.equal(result.status,0,result.stderr);
  const files=unzipSync(fs.readFileSync(output));assert.deepEqual([...files['word/media/image.bin']],[0,1,255]);
  assert.match(strFromU8(files['word/document.xml']),/xmlns:w="http:\/\/schemas.openxmlformats.org\/wordprocessingml\/2006\/main"/);
  assert.match(strFromU8(files['[Content_Types].xml']),/PartName="\/word\/media\/image.bin" ContentType="application\/octet-stream"/);
  const original=fs.readFileSync(output);const repeat=spawnSync(shell,['-NoProfile','-NonInteractive','-File',path.join(root,'tests/export-word-flat.ps1'),'-InputFile',path.join(directory,'valid.xml'),'-Destination',output],{encoding:'utf8',windowsHide:true,timeout:15000});assert.notEqual(repeat.status,0);assert.ok(original.equals(fs.readFileSync(output)));
});
test('invalid flat packages fail before creating a ZIP or accessing external entities',{skip:process.platform!=='win32'},()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-flat-invalid-'));
  const invalid=[pack(base+part('/../escape','<x/>')),pack(base+part('/word/./escape','<x/>')),pack(base+part('/word/%2e%2e/escape','<x/>')),pack(base+part('/word/document.xml','<x/>')),pack(part('/word/document.xml','<x/>')),'<!DOCTYPE pkg:package [<!ENTITY external SYSTEM "file:///never-read">]>'+pack(base)];
  for(let i=0;i<invalid.length;i++){const {result,output}=run(invalid[i],directory,'invalid'+i);assert.notEqual(result.status,0);assert.equal(fs.existsSync(output),false);}
});
