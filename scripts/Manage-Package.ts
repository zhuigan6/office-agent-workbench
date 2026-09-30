import {verifyPackage} from '../packages/distribution/index.ts';
import {upgradePackage,rollbackPackage} from '../packages/distribution/upgrade.ts';
const [action,first,second]=process.argv.slice(2);
if(action==='verify'&&first&&!second){const m=await verifyPackage(first);console.log(JSON.stringify({verified:true,version:m.version,files:Object.keys(m.files).length}));}
else if(action==='upgrade'&&first&&second)console.log(JSON.stringify(await upgradePackage(first,second)));
else if(action==='rollback'&&first&&second)console.log(JSON.stringify(await rollbackPackage(first,second)));
else throw Error('Usage: Manage-Package.ts verify PACKAGE | upgrade PACKAGE INSTALLATION | rollback INSTALLATION BACKUP_ID');
