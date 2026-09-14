import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const usage='Usage: node scripts/verify-session-authority.mjs --profile <disposable-profile> --agent-id <existing-non-main-agent> [--url <ws-url>] [--evidence-dir <ignored-dir>]';
if(args.includes('--help')){console.log(usage);process.exit(0);}
const profileArgument=option('--profile'),agentId=option('--agent-id');assert(profileArgument&&agentId,usage);const profile=resolve(profileArgument);assert.notEqual(agentId,'main','Use an existing non-main agent.');
const configPath=resolve(profile,'openclaw.json'),stateDir=resolve(profile,'state'),config=JSON.parse(readFileSync(configPath,'utf8')),token=config?.gateway?.auth?.token;
assert(typeof token==='string'&&token,'Profile has no Gateway token.');
const url=option('--url')??`ws://127.0.0.1:${config?.gateway?.port??18789}`,evidenceDir=resolve(option('--evidence-dir')??'evidence/issue-47/worker');mkdirSync(evidenceDir,{recursive:true,mode:0o700});
const receiptPath=resolve(evidenceDir,`session-authority-${new Date().toISOString().replaceAll(':','-')}.json`),receipt={fixtureOnly:true,noModelCalls:true,adapterEvidence:'Gateway plugins.sessionAction (not native UI)',profile,configPath,stateDir,url,agentId,observations:[],limits:[],cleanup:{}};
const save=()=>writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});process.env.OPENCLAW_CONFIG_PATH=configPath;process.env.OPENCLAW_STATE_DIR=stateDir;
const {GatewayClient}=await import('openclaw/plugin-sdk/gateway-runtime');
const events=[],clients=[];let privileged,readOnly,definition,current,foreign,parked=[];
const connect=scopes=>new Promise((resolveClient,reject)=>{let settled=false;const done=result=>{if(settled)return;settled=true;clearTimeout(timer);if(result instanceof Error)reject(result);else resolveClient(result);};const timer=setTimeout(()=>done(Error('Gateway connection timed out.')),15000);const client=new GatewayClient({url,token,env:{...process.env},sharedStateMode:'read-only',clientName:'cli',mode:'cli',scopes,onHelloOk:hello=>{receipt.observations.push({label:'gateway-hello',requestedScopes:scopes,grantedScopes:hello?.scopes??hello?.auth?.scopes??null});done(client);},onConnectError:error=>done(error instanceof Error?error:Error(String(error))),onEvent:event=>{if(event.event==='chat')events.push(event.payload);}});clients.push(client);client.start();});
const request=(client,method,params)=>client.request(method,params,{timeoutMs:30000});
const action=async(client,actionId,session,payload={})=>{const response=await request(client,'plugins.sessionAction',{pluginId:'loops-poc',actionId,agentId,sessionKey:session.key,payload});assert.equal(response.ok,true,`Gateway rejected ${actionId}: ${JSON.stringify(response)}`);return response.result;};
const errorText=error=>error instanceof Error?error.message:String(error);
const denied=async(label,call,expectedMessage='Run not found in this session.')=>{
  let result;
  try{result=await call();}catch(error){
    // Only a structured Gateway permission failure can satisfy this branch.
    // Never classify our own assertion text or an unrelated transport error.
    if(!['INVALID_REQUEST','FORBIDDEN','UNAUTHORIZED','MISSING_SCOPE'].includes(error?.code)||!(/^(missing scope:|permission denied\b|access denied\b|forbidden\b|unauthorized\b)/i.test(errorText(error))))throw error;
    receipt.observations.push({label,deniedBy:'host',code:error.code,message:errorText(error)});return;
  }
  assert.equal(result?.kind,'loops-error',`${label} unexpectedly succeeded.`);
  assert.equal(result.error?.code,'LOOPS_INVALID_REQUEST',`${label} returned an unrelated plugin error.`);
  assert.equal(result.error?.message,expectedMessage,`${label} did not return the expected authority denial.`);
  receipt.observations.push({label,deniedBy:'plugin',code:result.error.code,message:result.error.message});
};
const waitChatTerminal=async(runId,label)=>{const deadline=Date.now()+30000;while(Date.now()<deadline){const event=events.find(value=>value?.runId===runId&&['final','error','aborted'].includes(value?.state));if(event){receipt.observations.push({label,chatTerminal:event.state,runId});return event;}await new Promise(resolve=>setTimeout(resolve,100));}throw Error(`Timed out awaiting terminal chat event for ${label}.`);};
const command=async(session,message,label)=>{const admission=await request(privileged,'chat.send',{agentId,sessionKey:session.key,message,idempotencyKey:randomUUID()});assert(admission?.runId,`chat.send supplied no run ID for ${label}.`);const terminal=await waitChatTerminal(admission.runId,label);(receipt.commandEvents??=[]).push(terminal);assert.equal(terminal.message?.usage?.totalTokens,0,`${label} must use the registered no-model command path.`);return terminal;};
const commandDenied=async(session,message,label)=>{const terminal=await command(session,message,label);assert.equal(terminal.state,'final');const content=terminal.message?.content,text=typeof content==='string'?content:content?.filter(part=>part.type==='text').map(part=>part.text).join('\n');assert(text?.includes('Run not found in this session.'),`${label} did not report the expected session denial.`);receipt.observations.push({label,deniedBy:'command',runId:terminal.runId??null});};
const inspectNewCommandRun=async(before,slug,input)=>{const rows=await action(privileged,'runs',current);for(const row of rows)if(!before.has(row.id)){const run=await action(privileged,'inspect',current,{runId:row.id});if(run.source==='command'&&run.definition?.slug===slug){assert.deepEqual(run.input,input);assert.deepEqual(run.owner,{agentId,sessionKey:current.key,sessionId:current.sessionId});return run;}}throw Error('No correlated command run was recorded.');};
try{
  privileged=await connect(['operator.admin','operator.write','operator.read']);readOnly=await connect(['operator.read']);
  assert.deepEqual([...receipt.observations[0].grantedScopes].sort(),['operator.admin','operator.read','operator.write']);assert.deepEqual(receipt.observations[1].grantedScopes,['operator.read']);
  current=await request(privileged,'sessions.create',{agentId,label:`Loops authority current ${randomUUID().slice(0,8)}`});foreign=await request(privileged,'sessions.create',{agentId,label:`Loops authority foreign ${randomUUID().slice(0,8)}`});assert(current?.key&&current?.sessionId&&foreign?.key&&foreign?.sessionId,'Public sessions.create did not return keys and IDs.');
  const suffix=randomUUID().slice(0,8),slug=`authority-fixture-${suffix}`,input={};definition={slug,name:`Authority fixture ${suffix}`,description:'Synthetic permission probe; no provider or model calls.',inputSchema:[],capabilities:[],nodes:[{id:'input',kind:'input',label:'Input'},{id:'wait',kind:'wait',label:'Wait',message:'Permission checkpoint'},{id:'return',kind:'return',label:'Return',value:'completed'}],edges:[{id:'input-wait',source:'input',target:'wait',port:'next'},{id:'wait-return',source:'wait',target:'return',port:'next'}],layout:{input:{x:0,y:0},wait:{x:260,y:0},return:{x:520,y:0}},limits:{maxExecutions:3,maxOutputBytes:1024}};
  const created=await action(privileged,'create',current,{definition,enabled:true});assert.equal(created?.kind,undefined,JSON.stringify(created));definition=created.record.definition;
  const direct=await action(privileged,'run',current,{slug,input,requestId:`authority-session-action-${suffix}`});assert.equal(direct.state,'waiting');assert.equal(direct.source,'session-action');assert.deepEqual(direct.owner,{agentId,sessionKey:current.key,sessionId:current.sessionId});assert.equal(direct.definition.id,definition.id);parked.push(direct.id);receipt.observations.push({label:'session-action-current-non-main',allowed:true,runId:direct.id,owner:direct.owner});
  await denied('session-action-foreign-status',()=>action(privileged,'status',foreign,{runId:direct.id}));await denied('session-action-read-only-write',()=>action(readOnly,'create',current,{definition:{...definition,slug:`${slug}-read-only`},enabled:true}),'Loop changes require an authorized agent tool or an operator with write access through the Loops UI or a command.');
  await commandDenied(foreign,`/loops status ${direct.id}`,'command-foreign-status');
  await denied('command-read-only-write',()=>request(readOnly,'chat.send',{agentId,sessionKey:current.key,message:`/loops resume ${direct.id}`,idempotencyKey:randomUUID()}));
  const before=new Set((await action(privileged,'runs',current)).map(run=>run.id)),encoded=Buffer.from(JSON.stringify({slug,input,requestId:`authority-command-${suffix}`})).toString('base64');await command(current,`/loops run --json-base64 ${encoded}`,'command-current-non-main');const commandRun=await inspectNewCommandRun(before,slug,input);assert.equal(commandRun.state,'waiting');parked.push(commandRun.id);receipt.observations.push({label:'command-current-non-main',allowed:true,runId:commandRun.id,owner:commandRun.owner,input});
  const runEvidence=[];for(const id of parked){const settled=await action(privileged,'resume',current,{runId:id});assert.equal(settled.state,'completed',`Could not settle own parked run ${id}.`);runEvidence.push(await action(privileged,'inspect',current,{runId:id}));}receipt.cleanup.parkedRunsSettled=parked;receipt.runEvidence=runEvidence;
  const oldSessionId=current.sessionId,reset=await request(privileged,'sessions.reset',{key:current.key,agentId,reason:'reset'});receipt.resetResponse=reset;assert.equal(reset?.ok,true);assert(reset.entry?.sessionId,'sessions.reset did not return a current session ID.');current={key:reset.key??current.key,sessionId:reset.entry.sessionId};receipt.observations.push({label:'sessions-reset',oldSessionId,newSessionId:current.sessionId,key:current.key,lifecycleRevision:reset.entry.lifecycleRevision??null});
  if(current.sessionId===oldSessionId){
    const retained=await action(privileged,'status',current,{runId:direct.id});assert.equal(retained.id,direct.id);assert.equal(retained.state,'completed');
    receipt.observations.push({label:'reset-preserves-current-session-authority',allowed:true,runId:retained.id});
  }else{
    await denied('session-action-replaced-status',()=>action(privileged,'status',current,{runId:direct.id}));await commandDenied(current,`/loops status ${direct.id}`,'command-replaced-status');
  }
  receipt.limits.push('Registered agent tools have no supported direct no-model Gateway RPC in OpenClaw 2026.9.3. This verifier does not invent one; a real agent-tool path requires a serial model-backed host run. Fake registered-adapter coverage is distinct evidence.');receipt.limits.push('Gateway operator scopes are host-granted connection scopes, not proof of independent people, team roles, reassignment, or durable reset authority. SDK03 remains unresolved.');
  const deleted=await action(privileged,'delete',current,{id:definition.id,expectedRevision:definition.revision});assert.equal(deleted?.deleted,true,`Fixture delete failed: ${JSON.stringify(deleted)}`);definition=undefined;receipt.cleanup.fixtureDeleted=true;receipt.status='passed';
  // The command recreates only our deleted synthetic key through the host.
  // This is actual identity replacement; ordinary reset can preserve identity.
  const removed=await request(privileged,'sessions.delete',{key:current.key,agentId});assert.equal(removed.deleted,true);receipt.replacementDeletion=removed;
  await commandDenied(current,`/loops status ${direct.id}`,'command-recreated-session-status');
  const history=await request(privileged,'chat.history',{agentId,sessionKey:current.key,limit:10});assert(history.sessionId&&history.sessionId!==current.sessionId,'Deleted conversation was not recreated with a different host identity.');receipt.replacementHistory=history;current={...current,sessionId:history.sessionId};
  await denied('session-action-recreated-session-status',()=>action(privileged,'status',current,{runId:direct.id}));
}catch(error){receipt.status='failed';receipt.failure={message:errorText(error)};throw error;
}finally{
  for(const runId of parked.filter(id=>!receipt.cleanup.parkedRunsSettled?.includes(id)))try{const cancelled=await action(privileged,'cancel',current,{runId});assert(['completed','cancelled'].includes(cancelled?.state));(receipt.cleanup.cancelledOnFailure??=[]).push(runId);}catch(error){receipt.cleanup[`runCancelFailure:${runId}`]=errorText(error);}
  if(definition&&privileged&&current)try{const deleted=await action(privileged,'delete',current,{id:definition.id,expectedRevision:definition.revision});assert.equal(deleted?.deleted,true,`Fixture cleanup failed: ${JSON.stringify(deleted)}`);receipt.cleanup.fixtureDeleted=true;}catch(error){receipt.cleanup.fixtureDeleteFailure=errorText(error);}
  for(const session of [current,foreign].filter(Boolean))try{const result=await request(privileged,'sessions.delete',{key:session.key,agentId});(receipt.cleanup.sessionDeleteResults??=[]).push(result);assert.equal(result?.ok,true);assert.equal(result?.deleted,true,'Synthetic session cleanup did not delete the session.');}catch(error){receipt.cleanup[`sessionDeleteFailure:${session.key}`]=errorText(error);}
  for(const client of clients)try{await client.stopAndWait({timeoutMs:5000});}catch(error){receipt.cleanup.stopFailure??=errorText(error);}
  if(Object.keys(receipt.cleanup).some(key=>key.includes('Failure'))){receipt.status='failed';process.exitCode=1;}save();
}
console.log(JSON.stringify({status:receipt.status,receipt:receiptPath,cleanup:receipt.cleanup}));
