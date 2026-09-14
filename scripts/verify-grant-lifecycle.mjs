import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';

// Use an installed Gateway and explicitly supplied disposable profile. Prepare
// parks synthetic runs; restart that Gateway externally before running finish.
// Agent coverage uses the revoked Wait case. Feature/command coverage also
// qualifies ordinary publication/disable and explicitly human Review decisions.
const [profileArg,surface,stage,outArg]=process.argv.slice(2);
assert(profileArg&&['feature','command','agent'].includes(surface)&&['prepare','finish'].includes(stage)&&outArg,
  'Usage: node scripts/verify-grant-lifecycle.mjs <disposable-profile> feature|command|agent prepare|finish <evidence-directory>');
const profile=resolve(profileArg),out=resolve(outArg),config=JSON.parse(readFileSync(resolve(profile,'openclaw.json')));
assert.equal(config.gateway.bind,'loopback');assert.equal(config.gateway.auth.mode,'token');
process.env.OPENCLAW_STATE_DIR=resolve(profile,'state');process.env.OPENCLAW_CONFIG_PATH=resolve(profile,'openclaw.json');
if(stage==='prepare'){assert.equal(existsSync(out),false,'Preserve previous evidence.');mkdirSync(out,{recursive:true,mode:0o700});}
else assert.equal(existsSync(resolve(out,'acceptance.json')),false,'This finished journey must not be replayed.');
const save=(name,value)=>writeFileSync(resolve(out,name+'.json'),JSON.stringify(value,null,2)+'\n',{mode:0o600});
const hash=text=>createHash('sha256').update(text).digest('hex');
const {GatewayClient}=await import('openclaw/plugin-sdk/gateway-runtime');
let client,session,sequence=0;const events=[],seen=new Set(),receipts=[];
try{
  await new Promise((done,reject)=>{
    const timer=setTimeout(()=>reject(Error('Gateway connection timed out')),15000);
    client=new GatewayClient({url:`ws://127.0.0.1:${config.gateway.port}`,token:config.gateway.auth.token,env:{...process.env},sharedStateMode:'read-only',clientName:'cli',mode:'cli',scopes:['operator.admin','operator.read','operator.write'],
      onHelloOk:()=>{clearTimeout(timer);done();},onConnectError:error=>{clearTimeout(timer);reject(error);},onEvent:event=>{if(event.event==='chat'&&event.payload?.sessionKey===session?.key)events.push(event.payload);}});client.start();
  });
  const rpc=(method,input)=>client.request(method,input,{timeoutMs:60000});
  const action=async(operation,input={})=>{const response=await rpc('plugins.sessionAction',{pluginId:'loops-poc',actionId:operation,agentId:'main',sessionKey:session.key,payload:input});assert.equal(response.ok,true,JSON.stringify(response));return response.result;};
  const invoke=async(operation,input={})=>{
    const step=++sequence;let result;
    if(surface==='feature')result=await action(operation,input);
    else{
      const name=operation==='load'?'loops_read':`loops_${operation}`;
      const message=surface==='command'?`/loops ${operation} --json-base64 ${Buffer.from(JSON.stringify(input)).toString('base64')}`:
        `Invoke the actual ${name} tool exactly once with this exact argument object: ${JSON.stringify(input)}. Use tool discovery if needed. This operation is explicitly requested for the disposable grant QA loop. Do not use slash commands or files, change other loops, or retry a failed tool. Report the actual result briefly, including any error.`;
      if(surface==='command')assert.ok(message.length<4096);
      const admission=await rpc('chat.send',{agentId:'main',sessionKey:session.key,message,idempotencyKey:randomUUID()});
      save(`${stage}-${step}-request`,{operation,input,message,admission,session});
      let terminal;const deadline=Date.now()+600000;
      while(Date.now()<deadline){terminal=events.find(event=>event.runId===admission.runId&&['final','error','aborted'].includes(event.state));if(terminal)break;await pause(200);}
      save(`${stage}-${step}-terminal`,terminal??{missing:true});assert.equal(terminal?.state,'final','Inspect the preserved request/history before any explicit recovery; no mutation is retried automatically.');
      const text=(terminal.message?.content??[]).filter(part=>part.type==='text').map(part=>part.text).join('\n');
      if(surface==='command'){
        assert.equal(terminal.message.usage.totalTokens,0);
        result=text.startsWith('Loops [')?{kind:'loops-error',display:text}:JSON.parse(text.split('\n\nRead the full JSON result with ')[0]);
      }else{
        const history=await rpc('chat.history',{sessionKey:session.key,limit:100});save(`${stage}-${step}-history`,history);
        const calls=(history.messages??[]).flatMap(message=>Array.isArray(message.content)?message.content:[]).filter(part=>part.type==='toolCall'),found=[];
        for(let message of history.messages??[]){
          const id=message.__openclaw?.id;if(!id||seen.has(id)||message.role!=='toolResult')continue;seen.add(id);
          if(message.__openclaw?.truncated){const full=await rpc('chat.message.get',{sessionKey:session.key,messageId:id});assert.equal(full.ok,true);message=full.message;}
          let report;try{report=JSON.parse((message.content??[]).filter(part=>part.type==='text').map(part=>part.text).join('\n'));}catch{continue;}
          if(report.tool?.name!==name)continue;
          const call=calls.find(call=>call.id===message.toolCallId);assert.ok(call,'Missing exact invocation evidence');
          assert.deepEqual(call.name==='tool_call'?call.arguments.args:call.arguments,input,'The model changed the requested arguments.');
          found.push({toolCallId:message.toolCallId,report});
        }
        assert.equal(found.length,1,'Expected one actual requested tool result. Preserve and inspect a model-only failure.');
        receipts.push({operation,chat:admission.runId,...found[0]});result=found[0].report.result.details;
      }
    }
    save(`${stage}-${step}-${operation}`,{operation,input,result});
    if(result?.kind==='loops-document'){
      const reference=result;let text='',offset=0;
      while(true){const page=await action('document',{documentId:reference.documentId,offset});assert.equal(page.offset,offset);assert.equal(page.sha256,reference.sha256);text+=page.text;if(page.nextOffset===null)break;offset=page.nextOffset;}
      assert.equal(Buffer.byteLength(text),reference.bytes);assert.equal(hash(text),reference.sha256);result=JSON.parse(text);
    }
    console.log(JSON.stringify({surface,stage,step,operation,state:result?.state,kind:result?.kind}));return result;
  };
  const proceed=(item,runId)=>invoke(item.park==='wait'?'resume':'review',item.park==='wait'?{runId}:{runId,decision:'approve'});
  const rejected=result=>{assert.equal(result.kind,'loops-error');assert.match(result.error?.code??result.display,/LOOPS_RUN_REVOKED/);};
  if(stage==='prepare'){
    const cases=[];
    for(const park of surface==='agent'?['wait']:['wait','review'])for(const revoked of surface==='agent'?[true]:[false,true]){
      session=await rpc('sessions.create',{agentId:'main',label:`Grant ${surface} ${park} QA ${randomUUID().slice(0,8)}`});
      const slug=`grant-${surface}-${park}-${randomUUID().slice(0,8)}`,definition={slug,name:`Grant ${surface} ${park} ${revoked?'revoke':'publish'}`,description:'Synthetic pinned-grant acceptance',inputSchema:[],capabilities:['model-info'],nodes:[{id:'input',kind:'input',label:'Input'},park==='wait'?{id:'park',kind:'wait',label:'Wait',message:'Hold before host dispatch'}:{id:'park',kind:'review',label:'Review',proposal:'Approve the synthetic model metadata read'},
        {id:'model',kind:'action',label:'Read model',capability:'model-info'},{id:'return',kind:'return',label:'Return',value:'{{nodes.model.model}}'},...park==='review'?[{id:'fail',kind:'fail',label:'Fail',reason:'Rejected'}]:[]],
      edges:[{id:'a',source:'input',target:'park',port:'next'},{id:'b',source:'park',target:'model',port:park==='wait'?'next':'approve'},{id:'c',source:'model',target:'return',port:'next'},...park==='review'?[{id:'d',source:'park',target:'fail',port:'reject'}]:[]],layout:{},limits:{maxExecutions:1000,maxOutputBytes:1048576}};
      const created=await invoke('create',{definition}),id=created.record.definition.id;assert.equal(created.record.enabledRevision,1);
      const run=await invoke('run',{slug,input:{},requestId:randomUUID()});assert.equal(run.state,park==='wait'?'waiting':'review');
      const before=await action('inspect',{runId:run.id});assert.equal(before.grantGeneration,created.record.grantGeneration);
      if(revoked){
        await invoke('revoke',{id});await invoke(park==='wait'?'enable':'publish',park==='wait'?{id,revision:1,enabled:true}:{id,revision:1,expectedRevision:1});
      }else{
        const draft={...created.record.definition,capabilities:[],nodes:[definition.nodes[0],{id:'return',kind:'return',label:'Return',value:'New publication'}],edges:[{id:'new',source:'input',target:'return',port:'next'}]};
        await invoke('draft',{definition:draft,expectedRevision:1});await invoke('publish',{id,revision:2,expectedRevision:2});await invoke('enable',{id,revision:2,enabled:false});
        assert.equal((await invoke('run',{slug,input:{},requestId:randomUUID()})).kind,'loops-error');
      }
      cases.push({session,id,slug,park,revoked,before});save('prepared-cases',cases);
    }
    save('preparation',{surface,profile,port:config.gateway.port,cases,agentReceipts:receipts});
    console.log('Preparation committed. Stop and restart this dedicated Gateway before finish.');
  }else{
    const prepared=JSON.parse(readFileSync(resolve(out,'preparation.json')));assert.equal(prepared.profile,profile);assert.equal(prepared.surface,surface);assert.equal(prepared.port,config.gateway.port);
    const outcomes=[];
    for(const item of prepared.cases){
      session=item.session;
      // Seed the per-process seen set so a previous prepare tool cannot be
      // mistaken for the current finish operation after reconnect/restart.
      if(surface==='agent'){const history=await rpc('chat.history',{sessionKey:session.key,limit:100});for(const message of history.messages??[])if(message.__openclaw?.id)seen.add(message.__openclaw.id);}
      assert.deepEqual(await action('inspect',{runId:item.before.id}),item.before);
      const result=await proceed(item,item.before.id);
      if(item.revoked){
        rejected(result);assert.deepEqual(await action('inspect',{runId:item.before.id}),item.before);
        const fresh=await invoke('run',{slug:item.slug,input:{},requestId:randomUUID()});assert.equal((await proceed(item,fresh.id)).state,'completed');
        await invoke('cancel',{runId:item.before.id});const retry=await invoke('retry',{runId:item.before.id,mode:'restart',requestId:randomUUID()});assert.equal(retry.parentRunId,item.before.id);
        assert.equal((await proceed(item,retry.id)).state,'completed');const recovered=await action('inspect',{runId:retry.id}),current=await action('load',{id:item.id});
        assert.equal(recovered.grantGeneration,current.grantGeneration);assert.notEqual(recovered.grantGeneration,item.before.grantGeneration);outcomes.push({id:item.id,original:item.before.id,fresh:fresh.id,retry:retry.id});
      }else{assert.equal(result.state,'completed');const inspected=await action('inspect',{runId:item.before.id});assert.deepEqual(inspected.definition,item.before.definition);assert.equal(inspected.grantGeneration,item.before.grantGeneration);assert.ok(inspected.trace.some(step=>step.nodeId==='model'&&step.state==='completed'));outcomes.push({id:item.id,original:item.before.id,completed:true});}
    }
    save('acceptance',{surface,port:config.gateway.port,cases:outcomes,agentReceipts:[...prepared.agentReceipts,...receipts],configuredModelActionOnly:true,gatewayRestartEvidence:'Record the external stopped/restarted Gateway process separately.'});
  }
}catch(error){save(`${stage}-failure`,{message:error.message,session,sequence,receipts});throw error;}
finally{await client?.stopAndWait({timeoutMs:5000});}
