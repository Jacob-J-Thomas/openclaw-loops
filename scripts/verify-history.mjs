import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const profile=process.argv[2]??'codex',mode=process.argv[3]??'prepare';
if(!['codex','ollama'].includes(profile))throw new Error('Choose codex or ollama.');
const script=profile==='codex'?'scripts/codex.sh':'scripts/dev.sh';
const directory=`${process.env.LOOPS_EVIDENCE_DIR??'evidence/release-alpha6'}/${profile}/history`;mkdirSync(directory,{recursive:true});
const save=(name,value)=>writeFileSync(`${directory}/${name}.json`,JSON.stringify(value,null,2)+'\n');
function cli(args){
  const response=spawnSync('bash',[script,...args],{encoding:'utf8',maxBuffer:16*1024*1024});
  let result;try{result=JSON.parse(response.stdout);}catch(cause){throw new Error(String(response.stderr||response.error||'No JSON response').slice(0,2000),{cause});}
  if(response.status!==0)throw new Error(String(result.error?.message??result.message??JSON.stringify(result)).slice(0,2000));
  return result;
}
const call=(method,params)=>{const response=cli(['gateway','call',method,'--params',JSON.stringify(params),'--json','--timeout','60000']);if(response.ok===false)throw new Error(response.error?.message??'Gateway action failed');return response;};
const session=mode==='prepare'?call('sessions.create',{agentId:'main',label:`Loops alpha.6 history ${randomUUID().slice(0,8)}`}):JSON.parse(readFileSync(`${directory}/session.json`,'utf8'));
const action=(actionId,payload)=>call('plugins.sessionAction',{pluginId:'loops-poc',actionId,payload,agentId:'main',sessionKey:session.key}).result;
if(mode==='prepare'){
  save('session',session);const slug=`history-${randomUUID().slice(0,8)}`;
  const definition={slug,name:'History acceptance',description:'Synthetic pagination and explicit retention fixture. No model calls or external effects.',inputSchema:[{name:'index',label:'Index',type:'number',required:true}],nodes:[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return index',value:'{{input.index}}'}],edges:[{id:'edge',source:'input',target:'return',port:'next'}],layout:{input:{x:0,y:0},return:{x:260,y:0}},capabilities:[],limits:{maxExecutions:1000,maxOutputBytes:1024*1024}};
  const record=action('create',{definition}).record;save('definition',record);
  const runs=[];
  for(let index=0;index<105;index++){
    const requestId=`history-${randomUUID()}`,run=action('run',{slug,input:{index},requestId});assert.equal(run.state,'completed');assert.equal(run.result,index);runs.push({id:run.id,requestId,index});
    if((index+1)%20===0)console.log(`Verified ${index+1}/105 synthetic history runs.`);
  }
  save('runs',runs);const first=action('history',{limit:100}),second=action('history',{cursor:first.nextCursor,limit:100});
  assert.equal(first.items.length,100);assert.equal(second.items.length,5);assert.equal(second.nextCursor,null);assert.equal(new Set([...first.items,...second.items].map(run=>run.id)).size,105);
  save('pages',{first,second});save('preview',action('retention',{policy:{keepLatest:104}}));
  console.log(JSON.stringify({profile,sessionKey:session.key,slug,runs:runs.length,pagination:true}));
}else if(mode==='inspect'){
  const runs=action('runs',{});save('after-runs',runs);save('preview-current',action('retention',{policy:{keepLatest:104}}));
  save('chat-history',call('chat.history',{agentId:'main',sessionKey:session.key,limit:100}));
  console.log(JSON.stringify({profile,sessionKey:session.key,count:runs.length}));
}else if(mode==='agent'){
  if(profile!=='codex')throw new Error('The live agent cleanup acceptance uses the isolated Codex dev profile.');
  call('sessions.patch',{key:session.key,agentId:'main',model:'openai/gpt-5.6-sol'});
  const startedAt=new Date().toISOString();save('agent-request',{startedAt,policy:{keepLatest:103}});
  const response=cli(['agent','--agent','main','--session-key',session.key,'--message','This is a dedicated synthetic Loops history acceptance conversation. Clean up its run history, keeping its latest 103 runs. Discover loops_retention, preview with exactly {policy:{keepLatest:103}}, then apply the returned planId with that same policy. Report the exact number removed. Do not invoke loops, use files, or change definitions.','--timeout','180','--json']);
  save('agent-turn',response);console.log(JSON.stringify({status:response.status,payloads:response.result?.payloads??response.payloads}));
}else if(mode==='assert'){
  const seeded=JSON.parse(readFileSync(`${directory}/runs.json`,'utf8')),remaining=action('runs',{}),history=JSON.parse(readFileSync(`${directory}/chat-history.json`,'utf8'));
  const calls=history.messages.flatMap(message=>message.role==='assistant'?(message.content??[]).filter(part=>part.type==='toolCall'&&part.name==='loops_retention'):[]);
  const results=history.messages.filter(message=>message.role==='toolResult'&&message.toolName==='loops_retention').map(message=>{assert.equal(message.isError,false);return JSON.parse(message.content[0].content);});
  assert.equal(calls.length,2);assert.equal(results.length,2);assert.deepEqual(calls[0].arguments,{policy:{keepLatest:103}});assert.equal(results[0].applied,false);assert.equal(results[1].applied,true);assert.equal(results[1].candidates.length,1);assert.equal(calls[1].arguments.applyPlanId,results[0].planId);assert.equal(remaining.length,103);
  const record=JSON.parse(readFileSync(`${directory}/definition.json`,'utf8')),first=seeded[0];
  assert(!remaining.some(run=>run.id===first.id));assert.throws(()=>action('run',{slug:record.definition.slug,input:{index:first.index},requestId:first.requestId}),/LOOPS_HISTORY_REMOVED|will not execute again/);
  save('acceptance',{profile,sessionKey:session.key,created:seeded.length,remaining:remaining.length,uiRemoved:first.id,agentRemoved:results[1].candidates[0].id,actualAgentCalls:true,removedRequestDoesNotExecute:true});console.log('Verified UI/agent history cleanup and retained admission identity against the installed plugin.');
}else throw new Error('Use prepare, inspect, agent or assert.');
