// A public SDK client is process-scoped so its OpenClaw identity is initialized
// only after the disposable profile environment has been installed. Lifecycle
// tests may select the public SDK from a matching previous host checkout.
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {monitorEventLoopDelay,performance} from 'node:perf_hooks';
import {clearInterval,setInterval} from 'node:timers';

// These fixed IPC values are emitted at execution boundaries, not at parent
// spawn time. The worker clock starts only after Node has entered this module.
const workerEnteredAt=performance.now();
const send=value=>{if(process.connected)process.send?.(value);};
const milestone=(phase,sequence)=>send({type:'startup-milestone',phase,sequence,workerElapsedMs:Math.max(0,Math.floor(performance.now()-workerEnteredAt))});
const observation=(phase,detail)=>{try{send({type:'startup-observation',phase,workerElapsedMs:Math.max(0,Math.floor(performance.now()-workerEnteredAt)),...(detail?{detail}:{})});}catch{/* Optional diagnostics cannot change the client outcome. */}};
const errorCategory=error=>{
  try{
    const message=String(error?.message??'');
    if(/ECONN|EPIPE/i.test(message))return 'transport';
    if(/auth|token|permission|scope|denied/i.test(message))return 'authorization';
    if(/timeout|timed out/i.test(message))return 'timeout';
    if(/socket|websocket/i.test(message))return 'transport';
  }catch{/* An uninspectable error remains in the original SDK failure path. */}
  return 'other';
};
milestone('worker-entry',0);
const loopDelay=monitorEventLoopDelay({resolution:20});loopDelay.enable();
let lastCpu=process.cpuUsage(),lastLoop=performance.eventLoopUtilization(),sampleCount=0;
let startupTelemetryClosed=false;
const closeStartupTelemetry=()=>{if(startupTelemetryClosed)return;startupTelemetryClosed=true;try{clearInterval(sample);loopDelay.disable();}catch{/* Optional diagnostics cannot change the client outcome. */}};
const sample=setInterval(()=>{
  if(sampleCount++>=16){closeStartupTelemetry();return;}
  try{
    const cpu=process.cpuUsage(lastCpu);lastCpu=process.cpuUsage();
    const loop=performance.eventLoopUtilization(lastLoop);lastLoop=performance.eventLoopUtilization();
    send({type:'startup-resource',workerElapsedMs:Math.max(0,Math.floor(performance.now()-workerEnteredAt)),rssBytes:process.memoryUsage.rss(),cpuUserMicros:cpu.user,cpuSystemMicros:cpu.system,loopDelayMaxMs:Math.max(0,Math.floor(loopDelay.max/1e6)),loopUtilization:Number.isFinite(loop.utilization)?Math.max(0,Math.min(1,loop.utilization)):0});
    loopDelay.reset();
  }catch{closeStartupTelemetry();/* Optional diagnostics cannot change the client startup outcome. */}
},1000);sample.unref();
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
let client,ready=false,stopping=false,failed=false,clientStarted=false,pendingReady=false;
const stop=async()=>{closeStartupTelemetry();if(stopping)return;stopping=true;clearTimeout(startup);await client?.stopAndWait({timeoutMs:5000}).catch(()=>{});};
const fail=async error=>{closeStartupTelemetry();if(failed||stopping)return;failed=true;send({type:'error',message:String(error?.message??error)});await stop();process.exit(1);};
const startup=setTimeout(()=>{void fail(Error('Gateway client startup timed out.'));},startupBudgetMs);
try{
  observation('client-construction-start');
  client=new GatewayClient({url,token,env:{...process.env},sharedStateMode:'read-only',clientName:'cli',mode:'cli',scopes:['operator.admin','operator.read','operator.write'],...configuredStartupBudget===undefined?{}:{preauthHandshakeTimeoutMs:startupBudgetMs,connectChallengeTimeoutMs:startupBudgetMs},onHelloOk:()=>{if(ready||stopping)return;ready=true;closeStartupTelemetry();clearTimeout(startup);observation('hello-ok');if(clientStarted)send({type:'ready'});else pendingReady=true;},onConnectError:error=>{observation('connect-error',errorCategory(error));void fail(error);},onClose:code=>observation('socket-close',Number.isInteger(code)&&code>=1000&&code<=4999?String(code):'unknown')});
  observation('client-constructed');
  client.start();
  observation('start-returned');
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
