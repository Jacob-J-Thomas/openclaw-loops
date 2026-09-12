import {existsSync,readFileSync} from 'node:fs';
import {repairGeneratedPolicy,writeProfileWithBackup} from './profile-policy.mjs';
for(const filename of ['.dev-profile/openclaw.json','.dev-profile/codex-test/openclaw.json']){
  if(!existsSync(filename))continue;
  const config=JSON.parse(readFileSync(filename,'utf8'));
  const repaired=repairGeneratedPolicy(config);
  if(repaired)writeProfileWithBackup(filename,config);
  console.log(`${filename}: ${repaired?'generated model restrictions removed; original backed up':'existing policy preserved'}`);
}
