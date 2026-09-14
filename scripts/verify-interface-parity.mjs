import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';

// An ordinary installed Gateway, explicitly supplied disposable profile, fresh
// conversation and uniquely named synthetic definitions. No provider clients,
// store edits, inferred model success, or changes to other conversations.
const [profileArg,surface]=process.argv.slice(2);
assert(profileArg&&['feature','command','agent'].includes(surface),'Usage: node scripts/verify-interface-parity.mjs <disposable-profile-directory> feature|command|agent');
const profile=resolve(profileArg),config=JSON.parse(readFileSync(resolve(profile,'openclaw.json'),'utf8'));
assert.equal(config.gateway.bind,'loopback');assert.equal(config.gateway.auth.mode,'token');
process.env.OPENCLAW_STATE_DIR=resolve(profile,'state');process.env.OPENCLAW_CONFIG_PATH=resolve(profile,'openclaw.json');
const evidence=resolve(process.env.LOOPS_EVIDENCE_DIR??'evidence/interface-parity',surface,randomUUID());mkdirSync(evidence,{recursive:true});
const save=(name,value)=>writeFileSync(resolve(evidence,name+'.json'),JSON.stringify(value,null,2)+'\n',{mode:0o600});
const hash=text=>createHash('sha256').update(text).digest('hex');
const {GatewayClient}=await import('openclaw/plugin-sdk/gateway-runtime');
let client,session,sequence=0;const events=[],seen=new Set(),operations=new Set(),receipts=[];
try{
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Gateway connection timed out')),15000);
    client=new GatewayClient({url:`ws://127.0.0.1:${config.gateway.port}`,token:config.gateway.auth.token,env:{...process.env},sharedStateMode:'read-only',clientName:'cli',mode:'cli',scopes:['operator.admin','operator.read','operator.write'],
      onHelloOk:()=>{clearTimeout(timer);resolve();},onConnectError:error=>{clearTimeout(timer);reject(error);},onEvent:event=>{if(event.event==='chat'&&event.payload?.sessionKey===session?.key)events.push(event.payload);}});client.start();
  });
  const rpc=(method,input)=>client.request(method,input,{timeoutMs:60000});
  session=await rpc('sessions.create',{agentId:'main',label:`Interface ${surface} QA ${randomUUID().slice(0,8)}`});save('session',session);
  const action=async(operation,input={})=>{const response=await rpc('plugins.sessionAction',{pluginId:'loops-poc',actionId:operation,agentId:'main',sessionKey:session.key,payload:input});assert.equal(response.ok,true);return response.result;};
  const chat=async message=>{
    const admission=await rpc('chat.send',{agentId:'main',sessionKey:session.key,message,idempotencyKey:randomUUID()});
    let terminal;const deadline=Date.now()+300000;
    while(Date.now()<deadline){terminal=events.find(event=>event.runId===admission.runId&&['final','error','aborted'].includes(event.state));if(terminal)break;await pause(200);}
    assert.equal(terminal?.state,'final',JSON.stringify(terminal));save(`chat-${admission.runId}`,{message,admission,terminal});
    return {admission,terminal,text:(terminal.message?.content??[]).filter(part=>part.type==='text').map(part=>part.text).join('\n')};
  };
  const agent=async(operation,input)=>{
    const name=operation==='load'?'loops_read':`loops_${operation}`;
    const turn=await chat(`Invoke the actual ${name} tool exactly once with this exact argument object: ${JSON.stringify(input)}. Use tool discovery if needed. Do not use slash commands, other loop mutations, or files. Report the actual tool result briefly. If it returns a document reference, leave pagination to the next request. This is a requested operation on the dedicated synthetic QA data.`);
    const history=await rpc('chat.history',{sessionKey:session.key,limit:100});save(`history-${turn.admission.runId}`,history);
    const calls=(history.messages??[]).flatMap(message=>Array.isArray(message.content)?message.content:[]).filter(part=>part.type==='toolCall');
    const results=[];
    for(let message of history.messages??[]){
      const id=message.__openclaw?.id;if(!id||seen.has(id)||message.role!=='toolResult')continue;seen.add(id);
      if(message.__openclaw?.truncated){const full=await rpc('chat.message.get',{sessionKey:session.key,messageId:id});assert.equal(full.ok,true);message=full.message;}
      const text=(message.content??[]).filter(part=>part.type==='text').map(part=>part.text).join('\n');
      let report;try{report=JSON.parse(text);}catch{continue;}
      if(report.tool?.name!==name)continue;
      const call=calls.find(call=>call.id===message.toolCallId);
      assert.ok(call,`Missing complete invocation evidence for ${name}`);
      assert.deepEqual(call.name==='tool_call'?call.arguments.args:call.arguments,input,`${name} changed the requested arguments`);
      assert.ok(text.length<=16000,'Deferred report was oversized');
      const content=report.result.content.find(part=>part.type==='text');assert.ok(content.text.length<=8000);
      assert.deepEqual(JSON.parse(content.text),report.result.details);
      results.push({toolCallId:message.toolCallId,report});
    }
    assert.equal(results.length,1,`Expected exactly one actual ${name} result, got ${results.length}. Inspect the preserved chat; no mutation is retried automatically.`);
    receipts.push({operation,chat:turn.admission.runId,...results[0]});return results[0].report.result.details;
  };
  const invoke=async(operation,input={})=>{
    operations.add(operation);let result;
    if(surface==='feature')result=await action(operation,input);
    else if(surface==='agent')result=await agent(operation,input);
    else{
      const message=`/loops ${operation} --json-base64 ${Buffer.from(JSON.stringify(input)).toString('base64')}`;assert.ok(message.length<4096,'Use upload before an oversized command');
      const turn=await chat(message);assert.equal(turn.terminal.message.usage.totalTokens,0);assert.ok(turn.text.length<=8000);
      result=turn.text.startsWith('Loops [')?{kind:'loops-error',display:turn.text}:JSON.parse(turn.text.split('\n\nRead the full JSON result with ')[0]);
    }
    save(`operation-${String(++sequence).padStart(3,'0')}-${operation}`,{operation,input,result});
    if(result?.kind==='loops-document'){
      const reference=result;let text='',offset=0;
      while(true){const page=await invoke('document',{documentId:reference.documentId,offset});assert.equal(page.offset,offset);assert.equal(page.sha256,reference.sha256);text+=page.text;if(page.nextOffset===null)break;assert.equal(page.nextOffset,offset+Array.from(page.text).length);offset=page.nextOffset;}
      assert.equal(Buffer.byteLength(text),reference.bytes);assert.equal(hash(text),reference.sha256);result=JSON.parse(text);
    }
    console.log(JSON.stringify({surface,sequence,operation,state:result?.state,kind:result?.kind}));return result;
  };
  const slug=`interface-${surface}-${randomUUID().slice(0,8)}`;
  const content={slug,name:`Interface ${surface} QA`,description:'Synthetic three-interface acceptance',inputSchema:[{name:'text',label:'Text',type:'text',required:true}],capabilities:[],nodes:[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'{{input.text}}'}],edges:[{id:'next',source:'input',target:'return',port:'next'}],layout:{input:{x:20,y:80},return:{x:340,y:80}},limits:{maxExecutions:1000,maxOutputBytes:1048576}};
  const caps=await invoke('capabilities');assert.ok(caps.model);
  const created=await invoke('create',{definition:content}),id=created.record.definition.id;assert.equal(created.record.enabledRevision,1);
  assert.deepEqual(await invoke('load',{id}),created.record);
  assert((await invoke('library')).some(row=>row.id===id));assert((await invoke('list')).some(row=>row.id===id));
  assert.equal((await invoke('browse',{search:slug,limit:1})).total,1);
  assert.deepEqual((await invoke('validate',{definition:created.record.definition})).issues,[]);
  const saved=await invoke('save',{definition:{...created.record.definition,name:'Full saved revision'},expectedRevision:1,enabled:true});assert.equal(saved.record.enabledRevision,2);
  const draft=await invoke('draft',{definition:{...saved.record.definition,name:'Draft with publication'},expectedRevision:2});assert.equal(draft.record.enabledRevision,2);
  assert.equal((await invoke('edit',{id,expectedRevision:3,changes:{description:'Edited through '+surface}})).record.enabledRevision,4);
  assert.deepEqual((await invoke('versions',{id})).map(row=>row.revision),[4,3,2,1]);
  const restored=await invoke('restore',{id,revision:2,expectedRevision:4});assert.equal(restored.record.definition.revision,5);assert.equal(restored.record.enabledRevision,4);
  assert.equal((await invoke('publish',{id,revision:5,expectedRevision:5})).enabledRevision,5);
  assert.equal((await invoke('describe',{slug})).revision,5);
  assert.equal((await invoke('enable',{id,revision:5,enabled:false})).enabledRevision,null);
  assert.equal((await invoke('run',{slug,input:{text:'Disabled'},requestId:randomUUID()})).kind,'loops-error');
  await invoke('enable',{id,revision:5,enabled:true});
  const json=JSON.stringify({text:'Staged 🙂 result\nwith newline'}),sha256=hash(json),uploadId=randomUUID();
  await invoke('upload',{uploadId,offset:0,textBase64:Buffer.from(json.slice(0,8)).toString('base64')});
  const upload=await invoke('upload',{uploadId,offset:8,textBase64:Buffer.from(json.slice(8)).toString('base64'),complete:true,sha256});assert.equal(upload.completed,true);
  const run=await invoke('run',{slug,input:upload.reference,requestId:randomUUID()});assert.equal(run.state,'completed');assert.equal(run.result,JSON.parse(json).text);
  assert.equal((await invoke('status',{runId:run.id})).state,'completed');assert((await invoke('runs')).some(row=>row.id===run.id));
  assert.equal((await invoke('history',{limit:1})).total,1);
  assert.equal((await invoke('inspect',{runId:run.id})).result,run.result);assert.equal((await invoke('output',{runId:run.id})).text,run.result);
  const waitingDefinition={...restored.record.definition,nodes:[content.nodes[0],{id:'wait',kind:'wait',label:'Wait',message:'Continue explicitly'},content.nodes[1]],edges:[{id:'a',source:'input',target:'wait',port:'next'},{id:'b',source:'wait',target:'return',port:'next'}]};
  const wait=await invoke('test',{definition:waitingDefinition,input:{text:'Wait result'},requestId:randomUUID()});assert.equal(wait.state,'waiting');
  assert.equal((await invoke('resume',{runId:wait.id})).result,'Wait result');
  const cancelled=await invoke('test',{definition:waitingDefinition,input:{text:'Cancelled'},requestId:randomUUID()});assert.equal((await invoke('cancel',{runId:cancelled.id})).state,'cancelled');
  const retried=await invoke('retry',{runId:cancelled.id,mode:'restart',requestId:randomUUID()});assert.equal(retried.parentRunId,cancelled.id);assert.equal(retried.state,'waiting');await invoke('cancel',{runId:retried.id});
  const reviewDefinition={...waitingDefinition,nodes:[content.nodes[0],{id:'review',kind:'review',label:'Review',proposal:'Explicit synthetic human decision'},content.nodes[1],{id:'fail',kind:'fail',label:'Fail',reason:'Rejected'}],edges:[{id:'a',source:'input',target:'review',port:'next'},{id:'b',source:'review',target:'return',port:'approve'},{id:'c',source:'review',target:'fail',port:'reject'}]};
  const review=await invoke('test',{definition:reviewDefinition,input:{text:'Human approved'},requestId:randomUUID()});assert.equal(review.state,'review');
  assert.equal((await invoke('resume',{runId:review.id})).kind,'loops-error');
  if(surface==='agent'){const human=await action('review',{runId:review.id,decision:'approve'});assert.equal(human.state,'completed');save('separate-human-decision',{runId:review.id,result:human});}
  else assert.equal((await invoke('review',{runId:review.id,decision:'approve'})).state,'completed');
  assert.equal((await invoke('revoke',{id})).revoked,true);
  assert.equal((await invoke('archive',{id,expectedRevision:5,archived:true})).archived,true);assert((await invoke('deleted')).some(row=>row.id===id));
  assert.equal((await invoke('recover',{id,expectedRevision:5})).enabledRevision,null);assert.equal((await invoke('delete',{id,expectedRevision:5})).deleted,true);
  const policy={keepLatest:1000},plan=await invoke('retention',{policy});assert.deepEqual(plan.candidates,[]);assert.equal((await invoke('retention',{policy,applyPlanId:plan.planId})).applied,true);
  const expected=['archive','browse','cancel','capabilities','create','delete','deleted','describe','draft','edit','enable','history','inspect','library','list','load','output','publish','recover','restore','resume','retention','retry','revoke','run','runs','save','status','test','upload','validate','versions',...surface==='agent'?[]:['review']];
  for(const name of expected)assert(operations.has(name),`Operation not exercised: ${name}`);
  const receipt={surface,profilePort:config.gateway.port,sessionKey:session.key,model:caps.model,loopId:id,operations:[...operations].sort(),sequence,actualAgentTools:receipts.length,outputSha256:hash(run.result),humanReviewSeparateFromAgent:true,documentCoverage:operations.has('document')?'this journey':'separate complete-output qualification',fixtureCompletions:0};
  save('agent-receipts',receipts);save('acceptance',receipt);console.log(JSON.stringify({evidence,...receipt}));
}catch(error){save('failure',{message:error.message,session,sequence,operations:[...operations],agentReceipts:receipts});throw error;}
finally{await client?.stopAndWait({timeoutMs:5000});}
