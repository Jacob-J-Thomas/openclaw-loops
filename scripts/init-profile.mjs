import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createProfile,repairGeneratedPolicy,writeProfileWithBackup} from './profile-policy.mjs';
import {assertNode,assertSetupLocation,ollamaPort} from './isolated-runtime.mjs';
const root=resolve('.dev-profile');
assertNode();
assertSetupLocation(resolve('.'),'ollama');
const providerPort=ollamaPort();
if(existsSync(`${root}/openclaw.json`)){
  const before=readFileSync(`${root}/openclaw.json`),config=JSON.parse(before.toString('utf8'));
  if(repairGeneratedPolicy(config))writeProfileWithBackup(`${root}/openclaw.json`,config,before);
  console.log('Kept the existing profile and repaired only a recognized generated Loops model policy.');
  process.exit(0);
}
const model='ollama/qwen3.5:4b';
const agentTools=JSON.parse(readFileSync('openclaw.plugin.json','utf8')).contracts.tools;
mkdirSync(`${root}/workspace`,{recursive:true,mode:0o700});
const config={
  gateway:{mode:'local',bind:'loopback',port:19491,auth:{mode:'token',token:randomBytes(32).toString('hex')},controlUi:{experimental:{customPlugins:true}}},
  discovery:{mdns:{mode:'off'}},browser:{enabled:false},cron:{enabled:false},logging:{file:`${root}/gateway.log`},
  agents:{defaults:{workspace:`${root}/workspace`,model:{primary:model,fallbacks:[]},models:{[model]:{params:{num_ctx:32768,thinking:false}}},thinkingDefault:'off',heartbeat:{every:'0m'}}},
  models:{providers:{ollama:{baseUrl:`http://127.0.0.1:${providerPort}`,api:'ollama',apiKey:'ollama-local',models:[{id:'qwen3.5:4b',name:'Qwen3.5 4B (isolated local POC)',reasoning:true,input:['text'],contextWindow:32768,contextTokens:32768,maxTokens:1024,params:{num_ctx:32768,thinking:false},cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}},
  tools:{profile:'coding',alsoAllow:agentTools},
  plugins:{allow:['loops-poc','ollama'],slots:{memory:'none'},entries:{'loops-poc':{enabled:true,llm:{allowAgentIdOverride:true,allowModelOverride:true}}}},
};
createProfile(`${root}/openclaw.json`,config);
console.log(`Created isolated profile for ${model} on http://127.0.0.1:19491 with provider port ${providerPort}. The local token remains in the private config.`);
