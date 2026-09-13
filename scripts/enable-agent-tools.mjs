import {existsSync,readFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {writeProfileWithBackup} from './profile-policy.mjs';

// Explicit upgrade helper: preserve model selection, auth and existing tool policy.
const file=resolve(process.argv[2]??'.dev-profile/openclaw.json');
if(!file.startsWith(resolve('.dev-profile')+sep)||!existsSync(file))throw new Error('Choose an existing configuration inside this project’s .dev-profile directory.');
const before=readFileSync(file),config=JSON.parse(before.toString('utf8'));
const names=JSON.parse(readFileSync('openclaw.plugin.json','utf8')).contracts.tools;
config.tools={...config.tools,alsoAllow:[...new Set([...(config.tools?.alsoAllow??[]),...names])]};
writeProfileWithBackup(file,config,before);
console.log(`Enabled ${names.length} Loops tool names for ${file}. Existing deny rules remain authoritative.`);
