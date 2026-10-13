import fs from 'node:fs/promises';
import path from 'node:path';

export function assertBuildDestination(root:string,destination:string){
  const relative=path.relative(path.resolve(root),path.resolve(destination));
  if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)&&relative.split(path.sep)[0]!=='.local'))throw Error('Build into a new .local staging directory or outside the source root, never a source/dependency folder.');
}
export async function ensureBuildParent(destination:string){
  const parent=path.dirname(destination);
  try{if(!(await fs.stat(parent)).isDirectory())throw Error('Build parent is not a directory.');}
  catch(error:any){if(error.code!=='ENOENT')throw error;await fs.mkdir(parent,{recursive:true});}
}

export async function buildInputs(root:string,env:NodeJS.ProcessEnv){
  const explicit=[env.WORKBENCH_BUILD_AIONCORE,env.WORKBENCH_BUILD_OFFICECLI,env.WORKBENCH_BUILD_RESOURCES];
  let aioncore:string,officecli:string,resources:string,secrets:string[]=[];
  if(explicit.some(Boolean)){
    if(!explicit.every(value=>typeof value==='string'&&value.trim()))throw Error('Provide all three WORKBENCH_BUILD_AIONCORE / OFFICECLI / RESOURCES paths.');
    [aioncore,officecli,resources]=explicit.map(value=>path.resolve(root,value!));
  }else{
    const cfg=JSON.parse(await fs.readFile(path.join(root,'.local/config.json'),'utf8'));
    if(typeof cfg.aioncore!=='string'||typeof cfg.officecli!=='string')throw Error('Build engine paths are missing.');
    aioncore=path.resolve(root,cfg.aioncore);officecli=path.resolve(root,cfg.officecli);resources=path.join(root,'.local/managed-resources');
    secrets=[cfg.uiToken,cfg.coreSecret,cfg.pfxPassword].filter((value):value is string=>typeof value==='string'&&value.length>12);
  }
  const manifest=JSON.parse(await fs.readFile(path.join(resources,'manifest.json'),'utf8'));
  if(manifest.schemaVersion!==2||manifest.runtimeKey!=='win32-x64'||!manifest.node||typeof manifest.node.root!=='string'||manifest.node.executable!=='node.exe'||!Array.isArray(manifest.clis)||manifest.clis.length)throw Error('Expected original Windows managed Node resources without bundled agent credentials or CLIs.');
  const base=await fs.realpath(resources),node=await fs.realpath(path.resolve(resources,manifest.node.root,manifest.node.executable));
  const relative=path.relative(base,node);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Managed Node escapes resources directory.');
  return {aioncore,officecli,resources,secrets};
}
