import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

// Live acceptance uses a dedicated synthetic conversation and definition. It
// never rewrites the user's feature-matrix loop or their other conversations.
const profile=process.argv[2]??'codex';
const mode=process.argv[3]??'setup';
if(!['codex','ollama'].includes(profile))throw new Error('Choose codex or ollama.');
const script=profile==='codex'?'scripts/codex.sh':'scripts/dev.sh';
const directory=`${process.env.LOOPS_EVIDENCE_DIR??'evidence/release-alpha'}/${profile}`;mkdirSync(directory,{recursive:true});
const save=(name,value)=>writeFileSync(`${directory}/${name}.json`,JSON.stringify(value,null,2)+'\n');
function cli(args){const result=spawnSync('bash',[script,...args],{encoding:'utf8',maxBuffer:32*1024*1024});try{return JSON.parse(result.stdout);}catch{throw new Error(`OpenClaw command failed (${result.status}): ${String(result.stderr??result.error??'No JSON response').slice(0,2000)}`);}}
const call=(method,params)=>{const result=cli(['gateway','call',method,'--params',JSON.stringify(params),'--json','--timeout','60000']);if(result.ok===false)throw new Error(`${method}: ${result.error?.message??'Request failed'}`);return result;};
const sessionFile=`${directory}/session.json`;
if(mode==='setup'){
  const session=call('sessions.create',{agentId:'main',label:`Loops release alpha ${profile} ${randomUUID().slice(0,8)}`});save('session',session);console.log(JSON.stringify({sessionKey:session.key,resolved:session.resolved}));
}else{
  const session=JSON.parse(readFileSync(sessionFile,'utf8'));
  const action=(actionId,payload)=>call('plugins.sessionAction',{pluginId:'loops-poc',actionId,payload,agentId:'main',sessionKey:session.key}).result;
  const slug=`release-alpha-${profile}`;
  if(mode==='prepare'){
    const content={slug,name:`Release alpha ${profile}`,description:'Dedicated synthetic release verification.',inputSchema:[{name:'text',label:'Text',type:'text',required:true}],nodes:[{id:'input',kind:'input',label:'Input'},{id:'summary',kind:'inference',label:'Summarize',prompt:'Summarize the following in one sentence. Return only that sentence.\n{{input.text}}',output:'text'},{id:'return',kind:'return',label:'Result',value:'{{nodes.summary.text}}'}],edges:[{id:'e1',source:'input',target:'summary',port:'next'},{id:'e2',source:'summary',target:'return',port:'next'}],layout:{input:{x:20,y:80},summary:{x:280,y:80},return:{x:540,y:80}},capabilities:['llm'],limits:{maxExecutions:1000,timeoutMs:180000,maxOutputBytes:1024*1024}};
    const record=action('create',{definition:content}).record;save('definition',record);save('capabilities',action('capabilities',{}));console.log(JSON.stringify({id:record.definition.id,enabledRevision:record.enabledRevision}));
  }else if(mode==='select-sol'){
    if(profile!=='codex')throw new Error('This model selection belongs to the Codex verification profile.');
    const result=call('sessions.patch',{key:session.key,agentId:'main',model:'openai/gpt-5.6-sol'});save('sol-selection',result);console.log('Selected Sol in the dedicated verification conversation.');
  }else if(mode==='user'){
    save('user-admission',call('chat.send',{agentId:'main',sessionKey:session.key,message:`/loops run ${slug} The community garden opens on Saturdays. Volunteers share its vegetables with neighbors. --request-id release-user-${randomUUID()}`,idempotencyKey:randomUUID()}));
    console.log('Submitted a real user chat command in the synthetic conversation.');
  }else if(mode==='agent'){
    const result=cli(['agent','--agent','main','--session-key',session.key,'--message',`Use the Loops tools to actually invoke my saved loop ${slug} on this text: The library added twelve reading seats. Its Saturday workshops are free. Report the real run ID and result. Use tool discovery if needed. Do not simulate the loop or access files.`,'--timeout','180','--json']);save('agent-turn',result);console.log(JSON.stringify({status:result.status,ok:result.ok,error:result.error,payloads:result.result?.payloads??result.payloads}));
  }else if(mode==='inspect'){
    const runs=action('runs',{});const details=runs.map(run=>action('inspect',{runId:run.id}));save('runs',details);const history=call('chat.history',{agentId:'main',sessionKey:session.key,limit:100});save('chat-history',history);
    console.log(JSON.stringify(details.map(run=>({id:run.id,state:run.state,source:run.source,revision:run.definition.revision,model:run.executionSettings?.model,result:run.result,error:run.error}))));
  }else if(mode==='assert'){
    const runs=JSON.parse(readFileSync(`${directory}/runs.json`,'utf8'));
    assert(runs.some(run=>run.source==='command'&&run.state==='completed'),'Real user command completion missing');
    assert(runs.some(run=>run.source==='tool'&&run.state==='completed'),'Real agent tool completion missing');
    assert(runs.filter(run=>run.source==='command'||run.source==='tool').every(run=>run.definition.slug===slug&&run.definition.revision===1));
    console.log(`${profile}: verified real command and agent-tool invocation of the same saved revision.`);
  }else throw new Error('Use setup, prepare, user, agent, inspect or assert.');
}
