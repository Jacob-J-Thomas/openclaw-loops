import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {createServer,createConnection,isIP} from 'node:net';
import {copyFileSync,createWriteStream,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const own=fileURLToPath(import.meta.url),pluginId='native-agent-proof';
const sha=value=>createHash('sha256').update(value).digest('hex');
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const errorFact=e=>({name:e?.name??'Error',message:String(e?.message??e),code:typeof e?.code==='string'?e.code:null,stack:String(e?.stack??e)});
const write=(file,value)=>writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const safeText=value=>typeof value==='string'?value.slice(0,256):null;
const safeNumber=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
export function validateNativeAgentEndpoint(value){
  assert(typeof value==='string'&&value.length>0&&value===value.trim()&&!/[\s\\]/.test(value),'Supply a valid local provider baseUrl.');
  let endpoint;try{endpoint=new URL(value);}catch{assert.fail('Supply a valid local provider baseUrl.');}
  assert(['http:','https:'].includes(endpoint.protocol)&&/^https?:\/\/[^/]/i.test(value),'Provider baseUrl must use HTTP or HTTPS with an explicit host.');
  assert(!endpoint.username&&!endpoint.password&&!value.split('/')[2].includes('@')&&!value.includes('?')&&!value.includes('#'),'Provider baseUrl must not contain credentials, query or fragment.');
  const host=endpoint.hostname;
  assert(host==='localhost'||host==='[::1]'||(isIP(host)===4&&host.startsWith('127.')),'Provider baseUrl must use a loopback host.');
  return value;
}
export function assertNativeAgentNodeVersion(version){
  assert(['v24.16.0','v26.1.0'].includes(version),'Use exactly Node 24.16.0 or 26.1.0.');
}
export function assertNativeAgentCleanSource(status){
  assert(typeof status==='string'&&status.trim()==='','Native agent qualification requires a clean Git worktree and index.');
}
export function validateNativeAgentLeadConfig(value){
  assert(value&&typeof value==='object'&&!Array.isArray(value),'A lead-authored config object is required.');
  assert(Object.keys(value).every(key=>['selection','models'].includes(key)),'Config accepts only selection and explicit models.');
  const selection=value.selection;assert(selection&&typeof selection==='object','Explicit selection required.');
  assert.deepEqual(Object.keys(selection).sort(),['agentId','provider','model','thinking','timeoutMs','contextTokenBudget'].sort(),'Supply every selection field explicitly.');
  for(const key of ['agentId','provider','model','thinking'])assert(typeof selection[key]==='string'&&selection[key].length>0&&selection[key].length<=256,`Invalid ${key}.`);
  assert(Number.isInteger(selection.timeoutMs)&&selection.timeoutMs>=1000&&selection.timeoutMs<=180000);
  assert(Number.isInteger(selection.contextTokenBudget)&&selection.contextTokenBudget>=4096&&selection.contextTokenBudget<=65536);
  const provider=value.models?.providers?.[selection.provider];assert(provider&&typeof provider.baseUrl==='string','Supply the configured provider endpoint explicitly.');
  validateNativeAgentEndpoint(provider.baseUrl);
  assert(typeof provider.apiKey==='string'&&provider.apiKey.length>0&&!provider.apiKey.startsWith('${'),'Supply the disposable provider key explicitly; no credential/environment discovery.');
  assert(Array.isArray(provider.models)&&provider.models.some(model=>model.id===selection.model),'Selected model must be present in the supplied catalog.');
  return value;
}
export function nativeAgentExecutionTimeoutMs(selection,remainingMs){
  return Math.max(1,Math.min(selection.timeoutMs+30000,remainingMs));
}
export function nativeHistoryFacts(history,seed){
  const messages=Array.isArray(history?.messages)?history.messages:[];
  const content=m=>typeof m.content==='string'?m.content:Array.isArray(m.content)?m.content.filter(x=>x?.type==='text').map(x=>x.text??'').join('\n'):'';
  return {messages:messages.length,assistantSeed:messages.some(m=>m.role==='assistant'&&content(m).includes(seed)),sha256:sha(JSON.stringify(messages)),sessionId:history?.sessionId??null};
}
export function assertNativeAgentRead(record,selection,seed){
  assert.equal(record.settled,true,'Native host promise must settle.');assert.equal(record.state,'completed');assert.equal(record.modelCallStarted,true,'No actual model-call event observed.');
  assert.equal(record.result?.aborted,false);assert.equal(record.result?.error,null);assert.equal(record.result?.attribution?.provider,selection.provider);assert.equal(record.result?.attribution?.model,selection.model);
  assert(record.result?.attribution?.usage&&Object.values(record.result.attribution.usage).some(v=>typeof v==='number'&&v>0),'Returned native usage was not observed.');
  assert(record.tools.some(tool=>tool.toolName==='read'&&!tool.isError&&tool.text.includes(seed)),'A native read tool receipt containing the undisclosed seed is required.');
  assert(!record.tools.some(tool=>tool.toolName!=='read'),'Unexpected tool executed.');assert.match(record.result.text,/NATIVE_AGENT_READ/);assert(record.result.text.includes(seed),'Agent final answer did not use the actual read result.');
}
export function assertNativeAgentCancellation(record){
  assert.equal(record.modelCallStarted,true,'Cancellation cannot use a synthetic started event.');assert.equal(record.cancelRequested,true);assert.equal(record.activeAtCancellation,true,'Cancellation arrived after settlement.');
  assert.equal(record.settled,true,'Original native host promise is not settled.');assert(record.settledAt>=record.cancelRequestedAt);assert.equal(record.state,'aborted','Completion racing cancellation is not a cancellation pass.');
  assert(record.result?.aborted===true||record.error,'Need actual aborted metadata or host rejection.');
}
export function sanitizeNativeAgentReceipt(receipt){
  const passed=receipt.status==='passed'&&receipt.cleanup?.clientsStopped===true&&receipt.cleanup?.ownedProcessesExited===true&&receipt.cleanup?.hostPromisesSettled===true&&receipt.cleanup?.hostRequestsSettled===true;
  return {status:passed?'passed':'failed',source:safeText(receipt.source),verifierSha256:safeText(receipt.verifierSha256),fixtureSha256:safeText(receipt.fixtureSha256),installedFixtureSha256:safeText(receipt.installedFixtureSha256),fixtureManifestSha256:safeText(receipt.fixtureManifestSha256),sourceFilesSha256:safeText(receipt.sourceFilesSha256),sourceDirty:receipt.sourceDirty===true,host:receipt.host?{version:safeText(receipt.host.version),manifestSha256:safeText(receipt.host.manifestSha256),cliSha256:safeText(receipt.host.cliSha256),clientSha256:safeText(receipt.host.clientSha256)}:null,node:safeText(receipt.node),configSha256:safeText(receipt.configSha256),maxModelAdmissions:2,
    requested:receipt.requested?{agentId:safeText(receipt.requested.agentId),provider:safeText(receipt.requested.provider),model:safeText(receipt.requested.model),thinking:safeText(receipt.requested.thinking),timeoutMs:safeNumber(receipt.requested.timeoutMs),contextTokenBudget:safeNumber(receipt.requested.contextTokenBudget)}:null,
    observations:(receipt.observations??[]).map(o=>({label:safeText(o.label),classification:safeText(o.classification),code:safeText(o.code),passed:o.passed===true,...o.attribution?{attribution:{provider:safeText(o.attribution.provider),model:safeText(o.attribution.model),assistantTurns:safeNumber(o.attribution.assistantTurns),usage:Object.fromEntries(Object.entries(o.attribution.usage??{}).filter(([key,value])=>['input','output','cacheRead','cacheWrite','total','totalTokens'].includes(key)&&typeof value==='number'&&Number.isFinite(value)))}}:{}})),
    cleanup:{clientsStopped:receipt.cleanup?.clientsStopped===true,ownedProcessesExited:receipt.cleanup?.ownedProcessesExited===true,hostPromisesSettled:receipt.cleanup?.hostPromisesSettled===true,hostRequestsSettled:receipt.cleanup?.hostRequestsSettled===true},failure:passed?null:{code:'NATIVE_AGENT_PROOF_FAILED',phase:safeText(receipt.phase),privateDiagnostics:true},
    limits:['A fresh caller UUID is correlation required by runEmbeddedAgent, not pre-admitted host authority.','Requested reasoning/context ceiling are not proof of applied reasoning, aggregate-token or monetary enforcement.','Local host promise settlement is not remote-provider physical-stop attestation.','Durable transcript qualification and operator actions do not prove detached memory isolation, independent people, X08 product integration or X10 subagents.']};
}
async function clientWorker(){
  const req=createRequire(resolve(process.cwd(),'package.json')),{GatewayClient}=await import(pathToFileURL(req.resolve('openclaw/plugin-sdk/gateway-runtime')).href);
  let client,ready=false,stopping=false;
  const send=value=>{if(process.connected)process.send(value);};
  const stop=async()=>{stopping=true;clearTimeout(timer);await client?.stopAndWait({timeoutMs:5000});};
  const fail=async error=>{if(stopping)return;send({type:'error',error:errorFact(error)});try{await stop();}finally{process.exit(1);}};
  const timer=setTimeout(()=>void fail(Error('Native-agent client startup deadline.')),60000);
  process.on('message',async message=>{if(message?.type==='stop'){try{await stop();process.exit(0);}catch(error){send({type:'error',error:errorFact(error)});process.exit(1);}}if(message?.type!=='request'||!ready||stopping)return;try{send({type:'result',id:message.id,result:await client.request(message.method,message.params,{timeoutMs:message.timeoutMs})});}catch(error){send({type:'result',id:message.id,error:errorFact(error)});}});
  process.on('disconnect',()=>{void stop().finally(()=>process.exit(0));});
  client=new GatewayClient({url:process.env.NATIVE_AGENT_URL,token:process.env.NATIVE_AGENT_TOKEN,env:{...process.env},sharedStateMode:'read-only',clientName:'cli',mode:'cli',scopes:JSON.parse(process.env.NATIVE_AGENT_SCOPES),preauthHandshakeTimeoutMs:60000,connectChallengeTimeoutMs:60000,onHelloOk:()=>{ready=true;clearTimeout(timer);send({type:'ready'});},onConnectError:error=>void fail(error)});client.start();
}
async function main(){
  assert(process.argv[2],'Usage: node scripts/verify-native-agent.mjs <explicit-lead-model-config.json>');
  assertNativeAgentNodeVersion(process.version);
  const suppliedBytes=readFileSync(resolve(process.argv[2])),lead=validateNativeAgentLeadConfig(JSON.parse(suppliedBytes)),selection=lead.selection;
  const sourceStatus=execFileSync('git',['status','--porcelain','--untracked-files=all'],{encoding:'utf8'});assertNativeAgentCleanSource(sourceStatus);
  const startAt=Date.now(),deadline=startAt+10*60*1000,remaining=()=>{assert(Date.now()<deadline,'Ten-minute proof budget exhausted.');return deadline-Date.now();};
  const runId=randomUUID(),profile=resolve('.dev-profile',`native-agent-${runId}`),raw=resolve(profile,'raw'),workspace=resolve(profile,'workspace'),pluginRoot=resolve(profile,'plugin'),configPath=resolve(profile,'openclaw.json'),stateDir=resolve(profile,'state'),evidence=resolve('evidence','post-1.0','issue-242'),fixture=resolve('test/helpers/native-agent-plugin.mjs'),cli=resolve('node_modules/openclaw/openclaw.mjs');
  for(const dir of [raw,workspace,pluginRoot,evidence])mkdirSync(dir,{recursive:true,mode:0o700});
  const token=randomBytes(32).toString('hex'),seed=`native-agent-seed-${randomBytes(18).toString('hex')}`;writeFileSync(resolve(workspace,'seed.txt'),seed+'\n',{mode:0o600});
  copyFileSync(fixture,resolve(pluginRoot,'index.mjs'));write(resolve(pluginRoot,'package.json'),{name:pluginId,version:'0.0.0',private:true,type:'module',openclaw:{extensions:['./index.mjs']}});write(resolve(pluginRoot,'openclaw.plugin.json'),{id:pluginId,name:'Native full-agent proof',version:'0.0.0',activation:{onStartup:true},configSchema:{type:'object',additionalProperties:false,required:Object.keys(selection),properties:{agentId:{type:'string'},provider:{type:'string'},model:{type:'string'},thinking:{type:'string'},timeoutMs:{type:'integer',minimum:1000,maximum:180000},contextTokenBudget:{type:'integer',minimum:4096,maximum:65536}}}});
  // Explicit provider config is the only source of provider credentials. The
  // disposable profile owns auth storage; do not inherit provider secret envs.
  const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','SYSTEMROOT'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));Object.assign(env,{OPENCLAW_CONFIG_PATH:configPath,OPENCLAW_STATE_DIR:stateDir});
  let startRequests=0,seq=0,phase='setup',failure,gateway,admin,executor,readOnly,session,cancelSession,port;
  const clients=[],children=[],streams=[],handles=[],executions=[];
  const record=(label,value)=>write(resolve(raw,`${String(++seq).padStart(4,'0')}-${label.replace(/[^a-z0-9_-]/gi,'_')}.json`),value);
  const receipt={status:'failed',source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),verifierSha256:sha(readFileSync(own)),fixtureSha256:sha(readFileSync(fixture)),node:process.version,configSha256:sha(suppliedBytes),requested:selection,observations:[],cleanup:{clientsStopped:false,ownedProcessesExited:false,hostPromisesSettled:false,hostRequestsSettled:false}};
  receipt.installedFixtureSha256=sha(readFileSync(resolve(pluginRoot,'index.mjs')));receipt.fixtureManifestSha256=sha(readFileSync(resolve(pluginRoot,'openclaw.plugin.json')));receipt.sourceDirty=sourceStatus.trim()!=='';
  const sourceFiles=['test/contracts/native-agent-consumer.ts','test/helpers/native-agent-plugin.mjs','scripts/verify-native-agent.mjs','test/native-agent-sdk.test.mjs','docs/POST_1_0_NATIVE_AGENT.md'].map(file=>({file,sha256:sha(readFileSync(resolve(file)))}));receipt.sourceFilesSha256=sha(JSON.stringify(sourceFiles));record('source-files',sourceFiles);record('lead-config',lead);
  const observe=(label,classification,extra={})=>receipt.observations.push({label,classification,passed:true,...extra});
  const free=p=>new Promise(done=>{const s=createServer();s.once('error',()=>done(false));s.listen({host:'127.0.0.1',port:p},()=>s.close(()=>done(true)));});
  const probe=()=>new Promise(done=>{const socket=createConnection({host:'127.0.0.1',port});let ended=false;const finish=v=>{if(ended)return;ended=true;socket.destroy();done(v);};socket.setTimeout(500,()=>finish(false));socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));});
  const writeConfig=denyRead=>write(configPath,{gateway:{mode:'local',bind:'loopback',port,auth:{mode:'token',token},controlUi:{experimental:{customPlugins:true}}},discovery:{mdns:{mode:'off'}},browser:{enabled:false},cron:{enabled:false},logging:{file:resolve(raw,'host.log')},models:lead.models,agents:{defaults:{workspace,heartbeat:{every:'0m'},model:{primary:`${selection.provider}/${selection.model}`},maxConcurrent:1},list:[{id:selection.agentId,default:true,workspace,model:{primary:`${selection.provider}/${selection.model}`}}]},tools:{profile:'coding',deny:denyRead?['read','write']:['write']},plugins:{allow:[pluginId],load:{paths:[pluginRoot]},entries:{[pluginId]:{enabled:true,config:selection}}}});
  const exited=child=>child.exitCode!==null||child.signalCode!==null;
  const waitExit=(child,ms)=>new Promise((done,reject)=>{if(exited(child)){done();return;}const timer=setTimeout(()=>{child.removeListener('exit',finish);reject(Error('Owned process exit deadline.'));},ms);function finish(){clearTimeout(timer);done();}child.once('exit',finish);});
  const terminate=async child=>{if(!child||exited(child))return;child.kill('SIGTERM');try{await waitExit(child,7000);}catch{child.kill('SIGKILL');await waitExit(child,5000);}assert(exited(child));};
  const logChild=(child,label)=>{children.push(child);const stream=createWriteStream(resolve(raw,`${label}.log`),{flags:'a',mode:0o600});streams.push(stream);child.stderr.pipe(stream);child.on('error',error=>record('process-error',{label,error:errorFact(error)}));};
  const start=async ordinal=>{gateway=spawn(process.execPath,[cli,'gateway','run','--port',String(port),'--compact'],{env,stdio:['ignore','ignore','pipe']});logChild(gateway,`gateway-${ordinal}`);const until=Date.now()+Math.min(60000,remaining());while(Date.now()<until){assert(!exited(gateway),'Gateway exited before listening.');if(await probe())return;await pause(100);}throw Error('Gateway startup exceeded 60000 ms.');};
  const connect=async(scopes,label)=>{const child=spawn(process.execPath,[own,'--client'],{env:{...env,NATIVE_AGENT_URL:`ws://127.0.0.1:${port}`,NATIVE_AGENT_TOKEN:token,NATIVE_AGENT_SCOPES:JSON.stringify(scopes)},stdio:['ignore','ignore','pipe','ipc']});logChild(child,label);let next=0,readyResolve,readyReject;const pending=new Map(),ready=new Promise((yes,no)=>{readyResolve=yes;readyReject=no;}),timer=setTimeout(()=>readyReject(Error('Client startup timeout.')),Math.min(60000,remaining()));
    child.on('message',m=>{if(m?.type==='ready'){clearTimeout(timer);readyResolve();}else if(m?.type==='error'){record('client-error',m);clearTimeout(timer);readyReject(Object.assign(Error(m.error.message),m.error));}else if(m?.type==='result'){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(Object.assign(Error(m.error.message),m.error));else p.resolve(m.result);}}});child.once('error',e=>{clearTimeout(timer);readyReject(e);});child.once('exit',()=>{clearTimeout(timer);readyReject(Error('Client exited.'));for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Client exited with pending request.'));}pending.clear();});
    const h={child,label,request:(method,params,requestedTimeoutMs=30000)=>new Promise((yes,no)=>{const id=++next,timeoutMs=Math.min(requestedTimeoutMs,remaining()),timer=setTimeout(()=>{pending.delete(id);no(Error('RPC deadline.'));},timeoutMs);pending.set(id,{resolve:yes,reject:no,timer});child.send({type:'request',id,method,params,timeoutMs});}),stop:async()=>{if(exited(child))return;child.send({type:'stop'});try{await waitExit(child,7000);}catch(e){await terminate(child);throw e;}}};clients.push(h);await ready;return h;};
  const request=async(client,method,params,timeoutMs)=>{try{const result=await client.request(method,params,timeoutMs);record(method,{client:client.label,params,result});return result;}catch(error){record(method+'-error',{client:client.label,params,error:errorFact(error)});throw error;}};
  const action=async(client,key,payload,timeoutMs)=>{const r=await request(client,'plugins.sessionAction',{pluginId,actionId:'probe',agentId:selection.agentId,sessionKey:key,payload},timeoutMs);assert.equal(r.ok,true,'Host action envelope rejected.');return r.result;};
  const execute=h=>{startRequests++;const execution={handle:h,settled:false,hostSettled:false};execution.promise=action(executor,h.key,{operation:'execute',id:h.id},nativeAgentExecutionTimeoutMs(selection,remaining())).then(response=>{execution.settled=true;execution.hostSettled=response.executionResponseAfterSettlement===true&&response.record?.settled===true;return {ok:true,response};},error=>{execution.settled=true;return {ok:false,error};});executions.push(execution);return execution;};
  const settleExecution=async execution=>{const outcome=await execution.promise;if(!outcome.ok)throw outcome.error;assert.equal(outcome.response.ok,true);assert.equal(outcome.response.executionResponseAfterSettlement,true);assert.equal(outcome.response.record?.settled,true);return outcome.response.record;};
  const get=async(h)=>{const r=await action(admin,h.key,{operation:'inspect',id:h.id});assert.equal(r.ok,true,'Fixture current identity no longer matches.');return r.record;};
  const poll=async(h,predicate,ms)=>{const until=Date.now()+Math.min(ms,remaining());while(Date.now()<until){const r=await get(h);if(predicate(r))return r;if(r.settled)throw Error('Run settled before the required observation.');await pause(150);}throw Error('Native run observation deadline exceeded.');};
  const closeClients=async()=>{for(const c of clients)await c.stop();};
  try{
    assert.equal(receipt.installedFixtureSha256,receipt.fixtureSha256,'Fixture copy differs from declared source.');
    for(port=22271;port<22371;port++)if(await free(port))break;assert(port<22371,'No unused proof port.');writeConfig(false);
    const req=createRequire(resolve('package.json'));receipt.host={version:JSON.parse(readFileSync(resolve('node_modules/openclaw/package.json'),'utf8')).version,manifestSha256:sha(readFileSync(resolve('node_modules/openclaw/package.json'))),cliSha256:sha(readFileSync(cli)),clientSha256:sha(readFileSync(req.resolve('openclaw/plugin-sdk/gateway-runtime')))};assert.equal(receipt.host.version,'2026.9.5');
    phase='public-session-create';await start(0);admin=await connect(['operator.admin','operator.read','operator.write'],'admin-0');readOnly=await connect(['operator.read'],'readonly-0');executor=await connect(['operator.admin','operator.read','operator.write'],'executor-0');session=await request(admin,'sessions.create',{agentId:selection.agentId,label:`Native agent read ${runId.slice(0,8)}`});cancelSession=await request(admin,'sessions.create',{agentId:selection.agentId,label:`Native agent cancel ${runId.slice(0,8)}`});assert(session?.key&&session?.sessionId&&cancelSession?.key&&cancelSession?.sessionId);
    phase='current-policy-preflight';const policy=await action(admin,session.key,{operation:'policy'});assert.equal(policy.ok,true);assert.deepEqual(policy.available,{read:true,write:false});observe('write-excluded-by-current-host-policy','host-tool-factory-policy-exclusion');
    phase='readonly-denial';let denied=false;try{await action(readOnly,session.key,{operation:'policy'});}catch(error){assert(['MISSING_SCOPE','FORBIDDEN','UNAUTHORIZED'].includes(error.code));denied=true;observe('readonly-action-denied','host-gateway-scope',{code:error.code});}assert(denied);
    phase='read-tool-agent';const prepared=await action(admin,session.key,{operation:'prepare',case:'read'});assert.equal(prepared.ok,true);assert.equal(prepared.modelAdmissions,0);const readHandle={key:session.key,id:prepared.id};handles.push(readHandle);const readExecution=execute(readHandle);const read=await poll(readHandle,r=>r.settled,selection.timeoutMs+30000);assert.deepEqual(await settleExecution(readExecution),read);assertNativeAgentRead(read,selection,seed);assert.equal(read.owner.sessionId,session.sessionId);assert.equal(read.owner.agentId,selection.agentId);assert.equal(read.workspaceSha256,sha(workspace));assert.deepEqual(read.requested,selection);observe('native-tool-using-agent-settled','actual-agent-loop',{attribution:read.result.attribution});
    const foreign=await action(admin,cancelSession.key,{operation:'inspect',id:readHandle.id});assert.equal(foreign.ok,false);assert.equal(foreign.code,'FOREIGN_SESSION');assert.equal(foreign.hostDenied,false);observe('foreign-record-denied','fixture-owner',{code:foreign.code});
    phase='durable-history';const history=await request(admin,'chat.history',{agentId:selection.agentId,sessionKey:session.key,limit:100});const historyFacts=nativeHistoryFacts(history,seed);assert.equal(historyFacts.assistantSeed,true,'Durable assistant transcript lacks the observed seed.');assert.equal(historyFacts.sessionId,session.sessionId);observe('durable-assistant-transcript','public-chat-history');
    phase='active-cancellation';const cancelPrepared=await action(admin,cancelSession.key,{operation:'prepare',case:'cancel'});assert.equal(cancelPrepared.ok,true);assert.equal(cancelPrepared.modelAdmissions,1);const cancelHandle={key:cancelSession.key,id:cancelPrepared.id};handles.push(cancelHandle);const cancelExecution=execute(cancelHandle);const active=await poll(cancelHandle,r=>r.modelCallStarted&&!r.settled,selection.timeoutMs);assert.equal(active.settled,false);const cancelled=await action(admin,cancelSession.key,{operation:'cancel',id:cancelHandle.id});assert.equal(cancelled.ok,true);const settled=await poll(cancelHandle,r=>r.settled,selection.timeoutMs+30000);assert.deepEqual(await settleExecution(cancelExecution),settled);assertNativeAgentCancellation(settled);observe('active-cancel-original-promise-settled','local-host-settlement-only');
    phase='owned-restart-current-policy';await closeClients();await terminate(gateway);gateway=undefined;writeConfig(true);await start(1);admin=await connect(['operator.admin','operator.read','operator.write'],'admin-1');const afterRead=await get(readHandle),afterCancel=await get(cancelHandle);assert.deepEqual(afterRead,read);assert.deepEqual(afterCancel,settled);const afterHistory=await request(admin,'chat.history',{agentId:selection.agentId,sessionKey:session.key,limit:100});assert.deepEqual(nativeHistoryFacts(afterHistory,seed),historyFacts);observe('restart-durable-record-and-transcript','public-readback');
    const revoked=await action(admin,session.key,{operation:'policy'});assert.equal(revoked.ok,true);assert.deepEqual(revoked.available,{read:false,write:false});assert.equal(revoked.attempts,2);assert.equal(revoked.active,0);observe('current-read-policy-revoked','host-tool-factory-policy-exclusion');
    phase='session-reset-generation';const reset=await request(admin,'sessions.reset',{agentId:selection.agentId,key:session.key,reason:'reset'});assert.equal(reset.ok,true);const resetRead=await action(admin,reset.key??session.key,{operation:'inspect',id:readHandle.id});if(reset.entry.sessionId===read.owner.sessionId&&(reset.entry.lifecycleRevision??null)===read.owner.lifecycleRevision){assert.equal(resetRead.ok,true);observe('reset-preserved-generation','host-observed-no-generation-change');}else{assert.equal(resetRead.ok,false);assert.equal(resetRead.code,'SESSION_GENERATION_CHANGED');observe('reset-old-record-denied','fixture-generation',{code:resetRead.code});}
    phase='session-delete-recreation';const removed=await request(admin,'sessions.delete',{agentId:selection.agentId,key:session.key});assert.equal(removed.deleted,true);const missing=await action(admin,session.key,{operation:'inspect',id:readHandle.id});assert.equal(missing.ok,false);assert.equal(missing.code,'SESSION_UNAVAILABLE');observe('deleted-session-denied','fixture-current-session',{code:missing.code});
    const replacement=await request(admin,'sessions.create',{agentId:selection.agentId,key:session.key,label:'Native agent replacement'});assert.equal(replacement.key,session.key);assert.notEqual(replacement.sessionId,session.sessionId);const stale=await action(admin,replacement.key,{operation:'inspect',id:readHandle.id});assert.equal(stale.ok,false);assert.equal(stale.code,'SESSION_GENERATION_CHANGED');observe('recreated-session-old-record-denied','fixture-generation',{code:stale.code});
    receipt.cleanup.hostPromisesSettled=true;receipt.cleanup.hostRequestsSettled=executions.length===2&&executions.every(e=>e.settled&&e.hostSettled);receipt.status='passed';
  }catch(error){failure=error;record('failure',{phase,error:errorFact(error)});}
  receipt.phase=phase;
  // Drain owned calls before client/process cleanup. A deleted session cannot
  // inspect its old record, so successful proof establishes settlement earlier.
  if(!receipt.cleanup.hostPromisesSettled&&admin){let all=executions.length===startRequests;for(const h of handles)try{let r=await get(h);if(r.state==='prepared')continue;if(!r.settled){await action(admin,h.key,{operation:'cancel',id:h.id});r=await poll(h,x=>x.settled,15000);}all&&=r.settled;}catch(error){all=false;record('drain-error',errorFact(error));}try{if(session){const p=await action(admin,cancelSession?.key??session.key,{operation:'policy'});all=all&&p.ok===true&&p.active===0;}}catch(error){all=false;record('global-drain-error',errorFact(error));}receipt.cleanup.hostPromisesSettled=all;}
  if(!receipt.cleanup.hostRequestsSettled){let all=true;for(const execution of executions){let timer;try{await Promise.race([execution.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Pending execution RPC did not drain.')),15000);})]);}catch(error){all=false;record('execute-rpc-drain-error',errorFact(error));}finally{clearTimeout(timer);}}receipt.cleanup.hostRequestsSettled=all&&executions.every(e=>e.settled&&e.hostSettled);}
  receipt.cleanup.clientsStopped=true;for(const c of clients)try{await c.stop();}catch(error){receipt.cleanup.clientsStopped=false;failure??=error;record('client-cleanup-error',errorFact(error));}
  receipt.cleanup.ownedProcessesExited=true;for(const child of children)try{await terminate(child);}catch(error){receipt.cleanup.ownedProcessesExited=false;failure??=error;record('process-cleanup-error',errorFact(error));}receipt.cleanup.ownedProcessesExited&&=children.every(exited);
  for(const stream of streams)await new Promise(done=>{if(stream.closed){done();return;}stream.end(done);});
  if(failure||!Object.values(receipt.cleanup).every(Boolean))receipt.status='failed';
  if(!receipt.cleanup.ownedProcessesExited){process.exitCode=1;console.error('Owned process cleanup incomplete; raw evidence retained without a sanitized receipt.');return;}
  const path=resolve(evidence,`native-agent-${runId}${receipt.status==='passed'?'':'-failed'}.json`);write(path,sanitizeNativeAgentReceipt(receipt));console.log(JSON.stringify({status:receipt.status,receipt:path,raw,elapsedMs:Date.now()-startAt,cleanup:receipt.cleanup}));if(receipt.status!=='passed')process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===own){if(process.argv[2]==='--client')await clientWorker();else await main();}
