import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createProfile,configureLoopPolicy,writeProfileWithBackup} from './profile-policy.mjs';
import {assertNode,assertSetupLocation,profileEnvironment} from './isolated-runtime.mjs';

const root=resolve('.dev-profile/codex-test');
assertNode();
assertSetupLocation(resolve('.'),'codex-test');
const configPath=`${root}/openclaw.json`;
const model='openai/gpt-6-astra';
const agentTools=JSON.parse(readFileSync('openclaw.plugin.json','utf8')).contracts.tools;

if(process.argv[2]==='finish'){
  profileEnvironment(resolve('.'),'codex-test');
  const before=readFileSync(configPath),config=JSON.parse(before.toString('utf8'));
  if(!config.plugins?.entries?.codex?.enabled||!config.plugins?.entries?.['loops-poc']?.enabled){
    throw new Error('Install and enable both codex and loops-poc before finishing setup.');
  }
  const selected=config.agents.defaults.model.primary;
  configureLoopPolicy(config);
  // Keep this test profile's session picker separate from personal Codex history.
  config.plugins.entries.codex.config={sessionCatalog:{enabled:false}};
  config.tools={...config.tools,alsoAllow:[...new Set([...(config.tools?.alsoAllow??[]),...agentTools])]};
  writeProfileWithBackup(configPath,config,before);
  console.log(`Codex test profile configured for ${selected}.`);
}else if(existsSync(configPath)){
  const before=readFileSync(configPath),config=JSON.parse(before.toString('utf8'));
  if(config.browser===undefined&&config.plugins?.entries?.codex?.config?.sessionCatalog?.enabled===false&&
     Object.keys(config.plugins.entries.codex.config).length===1&&Object.keys(config.plugins.entries.codex.config.sessionCatalog).length===1){
    config.browser={enabled:false};
    writeProfileWithBackup(configPath,config,before);
  }
  profileEnvironment(resolve('.'),'codex-test');
  console.log('Keeping the existing Codex test profile.');
}else{
  mkdirSync(`${root}/workspace`,{recursive:true,mode:0o700});
  const config={
    gateway:{mode:'local',bind:'loopback',port:19691,auth:{mode:'token',token:randomBytes(32).toString('hex')},controlUi:{experimental:{customPlugins:true}}},
    discovery:{mdns:{mode:'off'}},browser:{enabled:false},cron:{enabled:false},logging:{file:`${root}/gateway.log`},
    agents:{defaults:{workspace:`${root}/workspace`,model:{primary:model,fallbacks:[]},heartbeat:{every:'0m'}}},
    models:{providers:{openai:{agentRuntime:{id:'codex'}}}},
    tools:{alsoAllow:agentTools},
    plugins:{entries:{codex:{enabled:false,config:{sessionCatalog:{enabled:false}}}}},
  };
  createProfile(configPath,config);
  console.log(`Created Codex test profile at http://127.0.0.1:19691 using ${model}.`);
}
