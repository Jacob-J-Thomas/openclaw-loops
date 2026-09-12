import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {configureLoopPolicy,writeProfileWithBackup} from './profile-policy.mjs';

const root=resolve('.dev-profile/codex-test');
const configPath=`${root}/openclaw.json`;
const model='openai/gpt-6-astra';
const agentTools=JSON.parse(readFileSync('openclaw.plugin.json','utf8')).contracts.tools;

if(process.argv[2]==='finish'){
  const config=JSON.parse(readFileSync(configPath,'utf8'));
  if(!config.plugins?.entries?.codex?.enabled||!config.plugins?.entries?.['loops-poc']?.enabled){
    throw new Error('Install and enable both codex and loops-poc before finishing setup.');
  }
  const selected=config.agents.defaults.model.primary;
  configureLoopPolicy(config);
  // Keep this test profile's session picker separate from personal Codex history.
  config.plugins.entries.codex.config={
    ...config.plugins.entries.codex.config,
    sessionCatalog:config.plugins.entries.codex.config?.sessionCatalog??{enabled:false},
  };
  config.tools={...config.tools,alsoAllow:[...new Set([...(config.tools?.alsoAllow??[]),...agentTools])]};
  writeProfileWithBackup(configPath,config);
  console.log(`Codex test profile configured for ${selected}.`);
}else if(existsSync(configPath)){
  console.log('Keeping the existing Codex test profile.');
}else{
  mkdirSync(`${root}/workspace`,{recursive:true,mode:0o700});
  const config={
    gateway:{mode:'local',bind:'loopback',port:19691,auth:{mode:'token',token:randomBytes(32).toString('hex')},controlUi:{experimental:{customPlugins:true}}},
    discovery:{mdns:{mode:'off'}},cron:{enabled:false},logging:{file:`${root}/gateway.log`},
    agents:{defaults:{workspace:`${root}/workspace`,model:{primary:model,fallbacks:[]},heartbeat:{every:'0m'}}},
    models:{providers:{openai:{agentRuntime:{id:'codex'}}}},
    tools:{alsoAllow:agentTools},
  };
  writeFileSync(configPath,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(`Created Codex test profile at http://127.0.0.1:19691 using ${model}.`);
}
