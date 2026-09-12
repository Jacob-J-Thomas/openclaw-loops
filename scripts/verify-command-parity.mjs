import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';

// Real Gateway/chat commands with synthetic definitions and a dedicated session.
// Only the final inference check calls a real model. Existing definitions stay intact.
const profile=process.argv[2]??'codex',probe=process.argv[3]==='probe';
assert(['codex','ollama'].includes(profile),'Choose codex or ollama.');
const root=resolve(profile==='codex'?'.dev-profile/codex-test':'.dev-profile');
process.env.OPENCLAW_STATE_DIR=resolve(root,'state');
process.env.OPENCLAW_CONFIG_PATH=resolve(root,'openclaw.json');
const config=JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH,'utf8'));
assert.equal(config.gateway.bind,'loopback');assert.equal(config.gateway.auth.mode,'token');
const evidence=resolve(process.env.LOOPS_EVIDENCE_DIR??'evidence/command-parity',profile);
mkdirSync(evidence,{recursive:true});
const save=(name,value)=>writeFileSync(resolve(evidence,`${name}.json`),JSON.stringify(value,null,2)+'\n',{mode:0o600});
const {GatewayClient}=await import('openclaw/plugin-sdk/gateway-runtime');
let client,session,sequence=0;
const events=[];
try{
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Gateway connection timed out.')),15000);
    client=new GatewayClient({url:`ws://127.0.0.1:${config.gateway.port}`,token:config.gateway.auth.token,
      env:{...process.env},sharedStateMode:'read-only',clientName:'cli',mode:'cli',
      scopes:['operator.admin','operator.read','operator.write'],
      onHelloOk:hello=>{clearTimeout(timer);try{assert(hello.auth.scopes.includes('operator.admin'),'The test profile must grant its existing owner identity.');resolve();}catch(error){reject(error);}},
      onConnectError:error=>{clearTimeout(timer);reject(error);},
      onEvent:event=>{if(event.event==='chat'&&event.payload?.sessionKey===session?.key)events.push(event.payload);},
    });client.start();
  });
  const rpc=(method,params)=>client.request(method,params,{timeoutMs:60000});
  session=await rpc('sessions.create',{agentId:'main',label:`Loops command parity ${profile} ${randomUUID().slice(0,8)}`});save('session',session);
  if(profile==='codex'&&!probe)await rpc('sessions.patch',{agentId:'main',key:session.key,model:'openai/gpt-5.6-sol'});
  const action=async(actionId,payload)=>{
    const response=await rpc('plugins.sessionAction',{pluginId:'loops-poc',actionId,agentId:'main',sessionKey:session.key,payload});
    assert.equal(response.ok,true);return response.result;
  };
  async function chat(args){
    const admission=await rpc('chat.send',{agentId:'main',sessionKey:session.key,message:`/loops ${args}`,idempotencyKey:randomUUID()});
    const deadline=Date.now()+60000;
    let final;
    while(Date.now()<deadline){
      final=events.find(event=>event.runId===admission.runId&&['final','error','aborted'].includes(event.state));
      if(final)break;
      await pause(100);
    }
    assert(final,`No terminal chat event for ${args.split(' ')[0]}.`);assert.equal(final.state,'final');
    let message=final.message,fullMessageId;
    if(message?.__openclaw?.truncated){
      const history=await rpc('chat.history',{agentId:'main',sessionKey:session.key,limit:4});
      const stored=history.messages.find(row=>row.role==='assistant'&&row.__openclaw?.idempotencyKey===admission.runId);
      assert(stored?.__openclaw?.id,'The truncated response must have an exact committed transcript identity.');
      fullMessageId=stored.__openclaw.id;
      const full=await rpc('chat.message.get',{agentId:'main',sessionKey:session.key,messageId:fullMessageId});
      assert.equal(full.ok,true);assert.equal(full.unavailableReason,undefined);assert(!full.message?.__openclaw?.truncated);
      message=full.message;
    }
    const text=(message?.content??[]).filter(part=>part.type==='text').map(part=>part.text).join('\n');
    assert(text,'The command did not return text.');
    save(`${String(++sequence).padStart(2,'0')}-${args.split(' ')[0]}`,{admission,args,response:text,...fullMessageId?{fullMessageId}:{}});
    return text;
  }
  const command=async(operation,payload)=>{
    const text=await chat(operation+(payload===undefined?'':' '+JSON.stringify(payload)));
    try{return JSON.parse(text);}catch{throw new Error(`The ${operation} command did not return complete JSON (${text.length} UTF-16 units). See its saved response.`);}
  };
  if(probe){console.log(JSON.stringify({profile,response:await chat('capabilities {}')}));}
  else{
    const caps=await command('capabilities',{});assert.equal(caps.model,profile==='codex'?'openai/gpt-5.6-sol':'ollama/qwen3.5:4b');
    assert((await chat('help')).includes('publish'));
    const slug=`command-parity-${randomUUID().slice(0,8)}`;
    const content={slug,name:'Synthetic command lifecycle',description:'Dedicated release verification. No changes to existing definitions.',
      inputSchema:[{name:'text',label:'Text',type:'text',required:true}],
      nodes:[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'{{input.text}}'}],
      edges:[{id:'next',source:'input',target:'return',port:'next'}],layout:{},capabilities:[],limits:{maxExecutions:1000,maxOutputBytes:1024*1024}};
    const created=await command('create',{definition:content}),id=created.record.definition.id;
    assert.equal(created.record.enabledRevision,1);
    assert.deepEqual(await command('read',{id}),await action('load',{id}));
    assert((await command('library')).some(row=>row.id===id));
    const runInput={slug,input:{text:'Synthetic command result.'}};
    const first=await command('run',runInput),second=await command('run',runInput);
    assert.equal(first.state,'completed');assert.equal(first.source,'command');assert.equal(first.result,runInput.input.text);assert.notEqual(first.id,second.id);
    const retryIdentity={...runInput,requestId:'explicit-'+randomUUID()};
    const third=await command('run',retryIdentity);assert.deepEqual(await command('run',retryIdentity),third);
    assert.equal((await command('history',{limit:1})).total,3);
    assert.equal((await command('inspect',{runId:first.id})).input.text,runInput.input.text);
    assert.equal((await command('output',{runId:first.id})).text,runInput.input.text);
    const oversized='run '+slug+' '+'Synthetic source. '.repeat(400);
    assert((await chat(oversized)).includes('HOST_COMMAND_INPUT_CHANGED'));
    assert.equal((await command('history',{})).total,3);
    const largeText='🙂x'.repeat(10000),encoded=JSON.stringify({text:largeText}),characters=Array.from(encoded),sha256=createHash('sha256').update(encoded).digest('hex');
    let reference;
    for(let offset=0;offset<characters.length;offset+=1000){
      const part={uploadId:'large-command-input',offset,text:characters.slice(offset,offset+1000).join(''),complete:offset+1000>=characters.length,sha256};
      assert(('upload '+JSON.stringify(part)).length<4096);
      reference=(await command('upload',part)).reference;
    }
    const large=await command('run',{slug,input:reference});assert.equal(large.state,'completed');assert.equal(large.resultTruncated,true);
    let complete='',offset=0;while(true){const page=await command('output',{runId:large.id,offset,limit:8000});complete+=page.text;if(page.nextOffset===null)break;offset=page.nextOffset;}
    assert.equal(complete,largeText);
    const draft=await command('draft',{definition:{...created.record.definition,name:'Draft preserves publication'},expectedRevision:1});
    assert.equal(draft.record.enabledRevision,1);assert.equal(draft.record.definition.revision,2);
    assert.deepEqual((await command('validate',{definition:draft.record.definition})).issues,[]);
    assert.deepEqual((await command('versions',{id})).map(row=>row.revision),[2,1]);
    assert.equal((await command('publish',{id,revision:2,expectedRevision:2})).enabledRevision,2);
    assert.equal((await command('describe',{slug})).revision,2);
    assert.equal((await command('edit',{id,expectedRevision:2,changes:{description:'Command edit'},enabled:false})).record.enabledRevision,null);
    assert.equal((await command('enable',{id,revision:3,enabled:true})).enabledRevision,3);
    assert((await chat(`edit ${JSON.stringify({id,expectedRevision:2,changes:{name:'Rejected stale edit'}})}`)).includes('LOOPS_REVISION_CONFLICT'));
    const restored=await command('restore',{id,revision:1,expectedRevision:3});assert.equal(restored.record.definition.revision,4);assert.equal(restored.record.enabledRevision,3);
    const tested=await command('test',{definition:restored.record.definition,input:runInput.input});assert.equal(tested.state,'completed');assert.equal(tested.testMode,true);
    const waitDefinition={...restored.record.definition,
      nodes:[content.nodes[0],{id:'wait',kind:'wait',label:'Wait',message:'Explicit synthetic checkpoint'},content.nodes[1]],
      edges:[{id:'a',source:'input',target:'wait',port:'next'},{id:'b',source:'wait',target:'return',port:'next'}]};
    const waiting=await command('test',{definition:waitDefinition,input:runInput.input});assert.equal(waiting.state,'waiting');
    assert.equal((await command('resume',{runId:waiting.id})).state,'completed');
    const cancelled=await command('test',{definition:waitDefinition,input:runInput.input});
    assert.equal((await command('cancel',{runId:cancelled.id})).state,'cancelled');
    const recovered=await command('retry',{runId:cancelled.id,mode:'restart'});assert.equal(recovered.state,'waiting');assert.equal(recovered.parentRunId,cancelled.id);
    await command('cancel',{runId:recovered.id});
    const reviewDefinition={...restored.record.definition,
      nodes:[content.nodes[0],{id:'review',kind:'review',label:'Review',proposal:'Synthetic review only'},content.nodes[1],{id:'fail',kind:'fail',label:'Fail',reason:'Explicit rejection'}],
      edges:[{id:'a',source:'input',target:'review',port:'next'},{id:'b',source:'review',target:'return',port:'approve'},{id:'c',source:'review',target:'fail',port:'reject'}]};
    const review=await command('test',{definition:reviewDefinition,input:runInput.input});assert.equal(review.state,'review');
    assert.equal((await command('review',{runId:review.id,decision:'approve'})).state,'completed');
    const rejected=await command('test',{definition:reviewDefinition,input:runInput.input});
    assert.equal((await command('review',{runId:rejected.id,decision:'reject'})).state,'failed');
    assert.equal((await command('archive',{id,expectedRevision:4,archived:true})).archived,true);
    assert((await command('deleted')).some(row=>row.id===id));
    assert.equal((await command('recover',{id,expectedRevision:4})).archived,false);
    assert.equal((await command('revoke',{id})).revoked,true);
    assert.equal((await command('delete',{id,expectedRevision:4})).deleted,true);
    let modelRun=await command('run',{slug:`release-alpha-${profile}`,input:{text:'Real command inference acceptance: a community library offers free weekend classes.'}});
    const modelDeadline=Date.now()+180000;
    while(['queued','running'].includes(modelRun.state)&&Date.now()<modelDeadline){await pause(1000);modelRun=await command('status',{runId:modelRun.id});}
    assert.equal(modelRun.state,'completed');assert.deepEqual(modelRun.models,[caps.model]);
    const result={profile,sessionKey:session.key,loopId:id,commands:sequence,source:'real chat.send',realInferenceRunId:modelRun.id,model:caps.model,
      capabilityDiscovery:true,enabledAuthoring:true,draftPublication:true,versionRestore:true,conflict:true,unpublishedTest:true,waitResume:true,cancelRecovery:true,humanReview:true,archiveRecoveryDelete:true,newAdmissionIdentity:true,retryDeduplication:true,completeOutput:true,stagedCommandInput:true,largeOutputBytes:Buffer.byteLength(largeText),hostTruncationRejected:true,uiReadParity:true};
    save('acceptance',result);console.log(JSON.stringify(result));
  }
}finally{await client?.stopAndWait({timeoutMs:5000});}
