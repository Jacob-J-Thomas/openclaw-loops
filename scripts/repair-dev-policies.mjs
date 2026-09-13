import {existsSync,readFileSync} from 'node:fs';
import {repairGeneratedPolicy,writeProfileWithBackup} from './profile-policy.mjs';
for(const filename of ['.dev-profile/openclaw.json','.dev-profile/codex-test/openclaw.json']){
  if(!existsSync(filename))continue;
  const before=readFileSync(filename),config=JSON.parse(before.toString('utf8'));
  const repaired=repairGeneratedPolicy(config);
  if(repaired)writeProfileWithBackup(filename,config,before);
  console.log(`${filename}: ${repaired?'generated model restrictions removed; original backed up':'existing policy preserved'}`);
}
