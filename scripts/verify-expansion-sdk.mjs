import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {createConnection,createServer} from 'node:net';
import {mkdirSync,readFileSync,writeFileSync,createWriteStream,copyFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {GatewayClient} from 'openclaw/plugin-sdk/gateway-runtime';
import {GATEWAY_STARTUP_BUDGET_MS,observeGatewayReadiness} from './gateway-readiness-evidence.mjs';

const pluginId='expansion-sdk-proof',actionId='probe',initialPort=21961;
// Receipt-only allowance after the fixed startup fail gate; a late listener still fails startup.
export const POST_DEADLINE_READINESS_DIAGNOSTIC_MS=45_000;
const hash=value=>createHash('sha256').update(value).digest('hex');
const errorText=error=>error instanceof Error?error.message:String(error);
const errorCode=error=>error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'?error.code:undefined;
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const free=port=>new Promise(resolveFree=>{const server=createServer();server.once('error',()=>resolveFree(false));server.listen({host:'127.0.0.1',port},()=>server.close(()=>resolveFree(true)));});
const listening=port=>new Promise(resolveListening=>{const socket=createConnection({host:'127.0.0.1',port});let settled=false;const finish=value=>{if(settled)return;settled=true;socket.destroy();resolveListening(value);};socket.setTimeout(1000,()=>finish(false));socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));});

export function sanitizeExpansionSdkReceipt(receipt){
  const observation=({label,allowed,hostDenied,code,flow,linked,stale,cancelled,activeTask,readback,serviceStarted,restarted})=>({
    label,...allowed===undefined?{}:{allowed},...hostDenied===undefined?{}:{hostDenied},...code?{code}:{},...flow?{flow}:{},...linked?{linked}:{},...stale?{stale}:{},...cancelled?{cancelled}:{},...activeTask?{activeTask}:{},...readback?{readback}:{},...serviceStarted===undefined?{}:{serviceStarted},...restarted===undefined?{}:{restarted},
  });
  return {
    source:receipt.source,verifierSha256:receipt.verifierSha256,fixturePluginSha256:receipt.fixturePluginSha256,node:receipt.node,openclaw:receipt.openclaw,
    noModelCalls:true,port:receipt.port,portSelection:receipt.portSelection,observations:receipt.observations.map(observation),cleanup:receipt.cleanup,
    limits:['The action receives a Gateway-authenticated current session, but the plugin must reject absent identity and preserve original grants/policy for future recurring work.','This no-model proof records host managed-flow state only. It does not prove agent inference, subagent cancellation settlement, provider authority, tool-category support, or a durable person/team principal.'],
  };
}

export const isOwnerBoundToSession=(ownerKey,sessionKey)=>typeof ownerKey==='string'&&typeof sessionKey==='string'&&sessionKey.length>0&&ownerKey===sessionKey;
export const observePostDeadlineGatewayReadiness=options=>observeGatewayReadiness({...options,remainingMs:()=>POST_DEADLINE_READINESS_DIAGNOSTIC_MS});

async function main(){
  const started=Date.now(),runId=randomUUID(),profile=resolve('.dev-profile',`expansion-sdk-${runId}`),raw=resolve(profile,'raw'),evidence=resolve('evidence','post-1.0','issue-229'),configPath=resolve(profile,'openclaw.json'),stateDir=resolve(profile,'state'),workspace=resolve(profile,'workspace'),pluginSource=resolve('test/helpers/expansion-sdk-plugin.mjs'),pluginRoot=resolve(profile,'plugin'),cli=resolve('node_modules/openclaw/openclaw.mjs');
  mkdirSync(raw,{recursive:true,mode:0o700});mkdirSync(workspace,{recursive:true,mode:0o700});mkdirSync(pluginRoot,{recursive:true,mode:0o700});mkdirSync(evidence,{recursive:true,mode:0o700});
  copyFileSync(pluginSource,resolve(pluginRoot,'index.mjs'),0);writeFileSync(resolve(pluginRoot,'package.json'),JSON.stringify({name:pluginId,version:'0.0.0',private:true,type:'module',openclaw:{extensions:['./index.mjs']}},null,2)+'\n',{mode:0o600});writeFileSync(resolve(pluginRoot,'openclaw.plugin.json'),JSON.stringify({id:pluginId,name:'Expansion SDK proof fixture',version:'0.0.0',description:'Disposable no-model managed-flow qualification fixture.',activation:{onStartup:true},configSchema:{type:'object',additionalProperties:false}},null,2)+'\n',{mode:0o600});
  let port=initialPort,portSelection='21961';
  if(!await free(port)){for(port=21962;port<22062;port++)if(await free(port)){portSelection='fallback-unused-private-port';break;}assert.notEqual(port,22062,'No private qualification port was available.');}
  const token=randomBytes(32).toString('hex'),env={...process.env,OPENCLAW_CONFIG_PATH:configPath,OPENCLAW_STATE_DIR:stateDir};
  writeFileSync(configPath,JSON.stringify({gateway:{mode:'local',bind:'loopback',port,auth:{mode:'token',token},controlUi:{experimental:{customPlugins:true}}},discovery:{mdns:{mode:'off'}},browser:{enabled:false},cron:{enabled:false},logging:{file:resolve(raw,'gateway.log')},agents:{defaults:{workspace,heartbeat:{every:'0m'}}},plugins:{allow:[pluginId],load:{paths:[pluginRoot]},entries:{[pluginId]:{enabled:true}}}},null,2)+'\n',{mode:0o600});
  const receipt={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),verifierSha256:hash(readFileSync(new URL(import.meta.url))),fixturePluginSha256:hash(readFileSync(pluginSource)),node:process.version,openclaw:null,port,portSelection,observations:[]};
  let gateway,privileged,readOnly;const clients=[];
  const start=async ordinal=>{
    const startedAt=Date.now();gateway=spawn(process.execPath,[cli,'gateway','run','--port',String(port),'--compact'],{env,stdio:['ignore','ignore','pipe']});gateway.stderr.pipe(createWriteStream(resolve(raw,`gateway-${ordinal}.log`),{flags:'a',mode:0o600}));
    const deadline=Date.now()+GATEWAY_STARTUP_BUDGET_MS;
    while(Date.now()<deadline){if(gateway.exitCode!==null||gateway.signalCode!==null)throw Error(`Gateway exited before listening (${gateway.exitCode??gateway.signalCode}).`);if(await listening(port)){receipt.observations.push({label:`gateway-start-${ordinal}`,allowed:true});return;}await pause(100);}
    const readiness=await observePostDeadlineGatewayReadiness({child:gateway,probe:()=>listening(port),startedAt,restartOrdinal:ordinal,pause});throw Error(`Gateway did not listen: ${JSON.stringify(readiness)}`);
  };
  const stop=async()=>{
    const child=gateway;if(!child)return {exited:true,signal:null};
    if(child.exitCode!==null||child.signalCode!==null){gateway=undefined;return {exited:true,signal:null};}
    const waitForExit=signal=>new Promise((done,reject)=>{const timer=setTimeout(()=>reject(Error(`Owned Gateway did not exit after ${signal}.`)),5000);child.once('exit',()=>{clearTimeout(timer);done();});if(!child.kill(signal)){clearTimeout(timer);reject(Error(`Could not signal owned Gateway with ${signal}.`));}});
    let signal='SIGTERM';try{await waitForExit(signal);}catch{signal='SIGKILL';await waitForExit(signal);}
    assert(child.exitCode!==null||child.signalCode!==null,'Owned Gateway remained alive after SIGTERM and SIGKILL.');gateway=undefined;return {exited:true,signal};
  };
  const connect=async scopes=>await new Promise((done,reject)=>{
    let client,settled=false;const settle=value=>{if(settled)return;settled=true;clearTimeout(timer);if(value instanceof Error)reject(value);else done(client);};const timer=setTimeout(()=>settle(Error('Gateway connection timed out.')),15_000);
    client=new GatewayClient({url:`ws://127.0.0.1:${port}`,token,env,sharedStateMode:'read-only',clientName:'cli',mode:'cli',scopes,onHelloOk:()=>settle(true),onConnectError:error=>settle(error instanceof Error?error:Error(String(error)))});clients.push(client);client.start();
  });
  const request=(client,method,params)=>client.request(method,params,{timeoutMs:30_000});
  const action=async(client,sessionKey,payload)=>{const response=await request(client,'plugins.sessionAction',{pluginId,actionId,sessionKey,payload});assert.equal(response.ok,true,JSON.stringify(response));return response.result;};
  const persistRaw=(name,value)=>writeFileSync(resolve(raw,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
  let failure;
  try{
    receipt.openclaw=execFileSync(process.execPath,[cli,'--version'],{encoding:'utf8'}).trim();
    await start(0);privileged=await connect(['operator.admin','operator.read','operator.write']);readOnly=await connect(['operator.read']);
    const session=await request(privileged,'sessions.create',{agentId:'main',label:`SDK05 proof ${runId.slice(0,8)}`}),foreign=await request(privileged,'sessions.create',{agentId:'main',label:`SDK05 foreign ${runId.slice(0,8)}`});assert(session?.key&&foreign?.key,'Gateway did not create disposable session keys.');
    const service=await action(privileged,session.key,{operation:'service'});assert.equal(service.serviceStarted,true);receipt.observations.push({label:'registered-service-action-ready',allowed:true,serviceStarted:true});
    const created=await action(privileged,session.key,{operation:'create'});assert(created.flow?.id&&created.flow.ownerKey&&created.flow.syncMode==='managed','Native managed-flow create returned an incomplete record.');
    const ownerBound=isOwnerBoundToSession(created.flow.ownerKey,session.key);assert.equal(ownerBound,true,'Native managed flow ownerKey was not bound to the authenticated session.');
    receipt.observations.push({label:'managed-flow-create',allowed:true,flow:{syncMode:created.flow.syncMode,ownerBound,revision:created.flow.revision}});
    const exercised=await action(privileged,session.key,{operation:'exercise',flowId:created.flow.id});persistRaw('exercise-response.json',exercised);receipt.observations.push({label:'managed-flow-linked-child-cancel-refusal',allowed:true,linked:{runtime:exercised.linked?.runtime,flowBound:exercised.linked?.flowId===created.flow.id,blockedByLinkedTask:exercised.waiting?.flow?.blockedTaskId===exercised.linked?.id},stale:{code:exercised.stale?.code},cancelled:{found:exercised.cancelled?.found,cancelled:exercised.cancelled?.cancelled,reason:exercised.cancelled?.reason},activeTask:{sameTask:exercised.activeTask?.id===exercised.linked?.id,status:exercised.activeTask?.status,runtime:exercised.activeTask?.runtime},readback:{sameFlow:exercised.readback?.id===created.flow.id,status:exercised.readback?.status,terminal:false}});assert.equal(exercised.linked.flowId,created.flow.id);assert.equal(exercised.waiting.flow.blockedTaskId,exercised.linked.id);assert.equal(exercised.stale.applied,false);assert.equal(exercised.stale.code,'revision_conflict');assert.equal(exercised.requested.applied,true);assert.equal(exercised.cancelled.found,true);assert.equal(exercised.cancelled.cancelled,false);assert.equal(exercised.cancelled.reason,'One or more child tasks are still active.');assert.equal(exercised.activeTask.id,exercised.linked.id);assert.equal(exercised.activeTask.status,'queued');assert.equal(exercised.readback.id,created.flow.id);assert(['queued','running','waiting','blocked'].includes(exercised.readback.status),`Queued-child flow unexpectedly became terminal: ${exercised.readback.status}`);assert.equal(exercised.readback.endedAt,null);
    const empty=await action(privileged,session.key,{operation:'cancel-empty'});persistRaw('empty-cancel-response.json',empty);receipt.observations.push({label:'managed-flow-empty-cancel',allowed:true,cancelled:{found:empty.cancelled?.found,cancelled:empty.cancelled?.cancelled,reason:empty.cancelled?.reason},readback:{sameFlow:empty.readback?.id===empty.created?.id,status:empty.readback?.status,terminal:empty.readback?.endedAt!==null}});assert.equal(empty.requested.applied,true);assert.equal(empty.cancelled.found,true);assert.equal(empty.cancelled.cancelled,true);assert.equal(empty.readback.id,empty.created.id);assert.equal(empty.readback.status,'cancelled');assert.equal(typeof empty.readback.endedAt,'number');
    const foreignRead=await action(privileged,foreign.key,{operation:'read',flowId:created.flow.id});assert.equal(foreignRead.flow,null,'A foreign session read a current-session managed flow.');receipt.observations.push({label:'foreign-session-flow-read',allowed:false,hostDenied:true});
    let readOnlyDenied=false;try{await action(readOnly,session.key,{operation:'service'});}catch(error){const code=errorCode(error);assert(['MISSING_SCOPE','FORBIDDEN','UNAUTHORIZED'].includes(code??''),`Read-only action failed without a Gateway scope error: ${errorText(error)}`);readOnlyDenied=true;receipt.observations.push({label:'read-only-session-action',allowed:false,hostDenied:true,code});}assert.equal(readOnlyDenied,true,'The host accepted a write-scoped session action from a read-only client.');
    let missing;try{missing=await action(privileged,undefined,{operation:'service'});}catch(error){missing={hostError:errorText(error)};}assert(missing?.hostError||missing?.code==='SESSION_REQUIRED','Absent session identity was neither rejected by host nor fixture.');receipt.observations.push({label:'missing-session-action',allowed:false,hostDenied:!!missing.hostError});
    await privileged.stopAndWait({timeoutMs:5000});privileged=undefined;await readOnly.stopAndWait({timeoutMs:5000});readOnly=undefined;const firstStop=await stop();assert.equal(firstStop.exited,true);
    await start(1);privileged=await connect(['operator.admin','operator.read','operator.write']);const restartedService=await action(privileged,session.key,{operation:'service'});assert.equal(restartedService.serviceStarted,true);const restartedRead=await action(privileged,session.key,{operation:'read',flowId:created.flow.id}),restartedEmpty=await action(privileged,session.key,{operation:'read',flowId:empty.created.id});assert.equal(restartedRead.flow?.id,created.flow.id,'Managed flow did not persist across the owned Gateway restart.');assert(['queued','running','waiting','blocked'].includes(restartedRead.flow?.status),`Queued-child flow became terminal after restart: ${restartedRead.flow?.status}`);assert.equal(restartedRead.flow?.endedAt,null);assert.equal(restartedEmpty.flow?.id,empty.created.id,'Empty managed flow did not persist across the owned Gateway restart.');assert.equal(restartedEmpty.flow?.status,'cancelled','Empty managed flow did not retain native cancellation across restart.');assert.equal(restartedEmpty.flow?.endedAt,empty.readback.endedAt,'Empty managed flow terminal timestamp changed across restart.');receipt.observations.push({label:'restart-flow-readback',allowed:true,restarted:true,serviceStarted:true,readback:{sameFlow:true,status:restartedRead.flow.status,terminal:false}});receipt.observations.push({label:'restart-empty-flow-cancel-readback',allowed:true,restarted:true,readback:{sameFlow:true,status:restartedEmpty.flow.status,terminal:true}});
  }catch(error){
    failure=error;
  }
  const cleanup={clientsStopped:true,gateway:{exited:true,signal:null}};
  for(const client of clients)try{await client.stopAndWait({timeoutMs:5000});}catch(error){cleanup.clientsStopped=false;failure??=error;}
  try{cleanup.gateway=await stop();}catch(error){cleanup.gateway={exited:false,signal:null};failure??=error;}
  receipt.cleanup=cleanup;
  if(failure){const failurePath=resolve(evidence,`sdk05-${runId}-failed.json`);writeFileSync(failurePath,JSON.stringify({...sanitizeExpansionSdkReceipt(receipt),status:'failed',failure:{message:errorText(failure)}},null,2)+'\n',{mode:0o600});throw failure;}
  assert.equal(cleanup.clientsStopped,true,'Gateway clients did not stop cleanly.');assert.equal(cleanup.gateway.exited,true,'Owned Gateway cleanup did not verify process exit.');
  const receiptPath=resolve(evidence,`sdk05-${runId}.json`);writeFileSync(receiptPath,JSON.stringify(sanitizeExpansionSdkReceipt(receipt),null,2)+'\n',{mode:0o600});console.log(JSON.stringify({status:'passed',receipt:receiptPath,elapsedMs:Date.now()-started,cleanup}));
}

const ownPath=fileURLToPath(import.meta.url);if(process.argv[1]&&resolve(process.argv[1])===ownPath)await main();
