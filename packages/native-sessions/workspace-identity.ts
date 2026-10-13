import path from 'node:path';
import {AppError} from '../contracts/index.ts';

export function assertOriginalWorkspace(thread:unknown,expectedId:string,expectedWorkspace:string){
  const value=thread as {id?:unknown;cwd?:unknown}|null;
  const normalized=(value:string)=>path.toNamespacedPath(path.resolve(value)).toLowerCase();
  if(!value||value.id!==expectedId||typeof value.cwd!=='string'||!path.isAbsolute(value.cwd)||normalized(value.cwd)!==normalized(expectedWorkspace))
    throw new AppError('NATIVE_SOURCE_MISMATCH','The original Codex workspace changed outside Workbench. Its folder assignment was preserved; create a new explicit connection instead.',409);
}
