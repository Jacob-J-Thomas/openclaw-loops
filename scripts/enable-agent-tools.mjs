import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';

// Explicit upgrade helper: preserve model selection, auth and existing tool policy.
const file=resolve(process.argv[2]??'.dev-profile/openclaw.json');
if(!file.startsWith(resolve('.dev-profile')+sep)||!existsSync(file))throw new Error('Choose an existing configuration inside this project’s .dev-profile directory.');
const config=JSON.parse(readFileSync(file,'utf8'));
const names=JSON.parse(readFileSync('openclaw.plugin.json','utf8')).contracts.tools;
config.tools={...config.tools,alsoAllow:[...new Set([...(config.tools?.alsoAllow??[]),...names])]};
const temp=`${file}.${randomUUID()}.tmp`;
writeFileSync(temp,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
renameSync(temp,file);
console.log(`Enabled ${names.length} Loops tool names for ${file}. Existing deny rules remain authoritative.`);
