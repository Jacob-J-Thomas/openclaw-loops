// A public SDK client is process-scoped so its OpenClaw identity is initialized
// only after the disposable profile environment has been installed. Lifecycle
// tests may select the public SDK from a matching previous host checkout.
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';

// These fixed IPC values are emitted at execution boundaries, not at parent
// spawn time. The worker clock starts only after Node has entered this module.
const workerEnteredAt=performance.now();
const send=value=>process.send?.(value);
const milestone=(phase,sequence)=>send({type:'startup-milestone',phase,sequence,workerElapsedMs:Math.max(0,Math.floor(performance.now()-workerEnteredAt))});
milestone('worker-entry',0);
const clientProjectRoot=resolve(process.env.LOOPS_GATEWAY_CLIENT_PROJECT_ROOT??'.');
const clientRequire=createRequire(resolve(clientProjectRoot,'package.json'));
const gatewayRuntime=clientRequire.resolve('openclaw/plugin-sdk/gateway-runtime');
const {GatewayClient}=await import(pathToFileURL(gatewayRuntime).href);
milestone('sdk-imported',1);
const url=process.env.LOOPS_GATEWAY_URL,token=process.env.LOOPS_GATEWAY_TOKEN;
if(!url||!token)throw Error('Disposable gateway endpoint and token are required.');
const configuredStartupBudget=process.env.LOOPS_GATEWAY_STARTUP_BUDGET_MS;
const startupBudgetMs=configuredStartupBudget===undefined?15_000:Number(configuredStartupBudget);
if(!Number.isSafeInteger(startupBudgetMs)||startupBudgetMs<1||startupBudgetMs>60_000)throw Error('Gateway client startup budget must be an integer from 1 to 60000 milliseconds.');
const timingPhases=new Set(['socket-open','challenge','connect-plan-ready','request-sent','hello','failed','fallback']);
const timing=value=>{const phase=value?.phase,generation=value?.generation,durationMs=value?.durationMs,phaseDurationMs=value?.phaseDurationMs,hasChallenge=value?.hasChallenge,usedFallback=value?.usedFallback;return {phase:timingPhases.has(phase)?phase:'unknown',generation:Number.isSafeInteger(generation)&&generation>=0?generation:0,durationMs:Number.isSafeInteger(durationMs)&&durationMs>=0?durationMs:0,phaseDurationMs:Number.isSafeInteger(phaseDurationMs)&&phaseDurationMs>=0?phaseDurationMs:0,hasChallenge:hasChallenge===true,usedFallback:usedFallback===true};};

let client,ready=false,stopping=false,failed=false,clientStarted=false,pendingReady=false;
const stop=async()=>{if(stopping)return;stopping=true;clearTimeout(startup);await client?.stopAndWait({timeoutMs:5000}).catch(()=>{});};
const fail=async error=>{if(failed||stopping)return;failed=true;send({type:'error',message:String(error?.message??error)});await stop();process.exit(1);};
const startup=setTimeout(()=>{void fail(Error('Gateway client startup timed out.'));},startupBudgetMs);
try{
  client=new GatewayClient({url,token,env:{...process.env},sharedStateMode:'read-only',clientName:'cli',mode:'cli',scopes:['operator.admin','operator.read','operator.write'],onTiming:value=>send({type:'timing',timing:timing(value)}),...configuredStartupBudget===undefined?{}:{preauthHandshakeTimeoutMs:startupBudgetMs,connectChallengeTimeoutMs:startupBudgetMs},onHelloOk:()=>{if(ready||stopping)return;ready=true;clearTimeout(startup);if(clientStarted)send({type:'ready'});else pendingReady=true;},onConnectError:error=>{void fail(error);}});
  client.start();
  milestone('client-started',2);
  clientStarted=true;
  if(pendingReady)send({type:'ready'});
}catch(error){void fail(error);}

process.on('message',async message=>{
  if(message?.type==='stop'){await stop();send({type:'stopped'});process.exit(0);return;}
  if(message?.type!=='request'||!ready)return;
  try{send({type:'result',id:message.id,result:await client.request(message.method,message.params,{timeoutMs:message.timeoutMs??60000})});}
  catch(error){send({type:'result',id:message.id,error:String(error?.message??error)});}
});
process.on('disconnect',()=>{void stop();});
