import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {root,local} from '../apps/local-host/config.ts';
import {assertOffline} from '../packages/distribution/upgrade.ts';

await assertOffline(root);
const file=path.join(local,'config.json');
if((await fs.lstat(file)).isSymbolicLink())throw Error('Linked configuration requires manual review');
const before=await fs.readFile(file),config=JSON.parse(before.toString());
if(typeof config.uiToken!=='string'||!config.uiToken)throw Error('Existing pairing token missing');
const id=randomUUID(),backup=path.join(local,`config-before-pairing-rotation-${id}.json`),next=path.join(local,`config-next-${id}.json`);
await fs.writeFile(backup,before,{flag:'wx',mode:0o600});
config.uiToken=randomBytes(32).toString('base64url');
await fs.writeFile(next,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
if(!(await fs.readFile(file)).equals(before))throw Error('Configuration changed concurrently; prepared token not activated');
await fs.rename(next,file);
console.log(JSON.stringify({rotated:true,backup,modelCredentialsChanged:false,scopedToolGrantsChanged:false,historyChanged:false,reconnect:'Open-Workbench.ps1'}));
