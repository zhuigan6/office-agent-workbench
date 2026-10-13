import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {AppError} from '../contracts/index.ts';
import {nativeVersion} from './compatibility.ts';
const execute=promisify(execFile);

export function claudeEntrypointShape(mainHelp:string,agentsHelp:string,attachHelp:string){
  return {
    background:/^\s+--bg,\s*--background\b/m.test(mainHelp),
    scopedInventory:/^Usage: claude agents \[options\]/m.test(agentsHelp)&&/^\s+--json\b/m.test(agentsHelp)&&/^\s+--cwd\b/m.test(agentsHelp),
    nativeAttach:/^Usage: claude attach <id(?:\|name)?>/m.test(attachHelp),
    // Neither state inventory nor terminal logs establish a shared send/event API.
    sharedTransportVerified:false,
  };
}

export function scopedClaudeInventory(output:string,workspace:string){
  if(Buffer.byteLength(output)>128*1024)throw new AppError('CLAUDE_INVENTORY_LIMIT','Claude state inventory exceeds the inspected limit.');
  let rows:unknown;try{rows=JSON.parse(output);}catch{throw new AppError('CLAUDE_INVENTORY_SHAPE','Claude returned no recognized JSON inventory.');}
  if(!Array.isArray(rows)||rows.length>256)throw new AppError('CLAUDE_INVENTORY_SHAPE','Claude state inventory shape changed.');
  return rows.map(row=>{
    if(!row||typeof row!=='object'||!['interactive','background'].includes(row.kind)||typeof row.cwd!=='string'||
      !path.isAbsolute(row.cwd)||path.resolve(row.cwd)!==path.resolve(workspace)||!Number.isSafeInteger(row.startedAt)||row.startedAt<0)
      throw new AppError('CLAUDE_INVENTORY_SCOPE','Claude returned a session outside the exact inspected workspace or an unknown shape.');
    const sessionId=typeof row.sessionId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.sessionId)?row.sessionId:null;
    const id=row.kind==='background'&&typeof row.id==='string'&&/^[0-9a-f]{8,36}$/i.test(row.id)?row.id:null;
    const state=['working','blocked','done','failed','stopped'].includes(row.state)?row.state:null;
    const status=['busy','waiting','idle'].includes(row.status)?row.status:null;
    return {kind:row.kind,startedAt:row.startedAt,sessionId,backgroundId:id,state,status,
      pid:Number.isSafeInteger(row.pid)&&row.pid>0?row.pid:null,
      nativeAttachCandidate:row.kind==='background'&&id!==null&&sessionId!==null,
      executionOwnershipVerified:false};
  });
}

async function hash(file:string){const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex');}

/** Public CLI metadata only: no resume, dispatch, hooks, credentials or transcript reads. */
export async function inspectClaudeEntrypoints(binary:string,workspace:string){
  if(!path.isAbsolute(binary)||!path.isAbsolute(workspace))throw new AppError('NATIVE_INVALID_INPUT','Supply exact installed CLI and workspace paths.');
  const real=await fs.realpath(binary),cwd=await fs.realpath(workspace);
  if(path.basename(real).toLowerCase()!=='claude.exe'||!(await fs.stat(real)).isFile()||!(await fs.stat(cwd)).isDirectory()||cwd===path.parse(cwd).root)
    throw new AppError('NATIVE_INVALID_INPUT','Use the selected installed Claude executable and a non-root workspace.');
  const before=await hash(real),run=async(args:string[])=>(await execute(real,args,{cwd,windowsHide:true,timeout:30000,maxBuffer:256*1024})).stdout;
  const version=nativeVersion('claude',await run(['--version'])),mainHelp=await run(['--help']),agentsHelp=await run(['agents','--help']),attachHelp=await run(['attach','--help']);
  const entrypoints=claudeEntrypointShape(mainHelp,agentsHelp,attachHelp);
  const sessions=entrypoints.scopedInventory?scopedClaudeInventory(await run(['agents','--json','--cwd',cwd]),cwd):null;
  if(before!==await hash(real)||version!==nativeVersion('claude',await run(['--version'])))
    throw new AppError('NATIVE_RUNTIME_CHANGED','Claude changed while probing; no handoff is permitted.');
  return {vendor:'claude',binary:real,binaryHash:before,version,workspace:cwd,entrypoints,sessions,
    fingerprint:createHash('sha256').update(JSON.stringify([version,mainHelp,agentsHelp,attachHelp])).digest('hex'),
    inspectionOnly:true,functionalPassed:false,modelRequests:0,configurationChanges:0,
    emptyInventoryDoesNotProveNoOwner:true};
}
