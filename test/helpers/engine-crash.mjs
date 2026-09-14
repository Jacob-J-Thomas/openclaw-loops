import {appendFileSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const [file,bundle,scenario,ready,effects,definitionFile,recoveryFile]=process.argv.slice(2);
const {Engine,SqliteStorage}=await import(pathToFileURL(bundle).href);
const definition=JSON.parse(readFileSync(definitionFile,'utf8'));
const actor={agentId:'main',sessionKey:'agent:main:crash-matrix',sessionId:'crash-fixture',source:'tool',human:false,check:()=>{}};
const store=new SqliteStorage(file);let armed=false;
function pause(run){
  writeFileSync(ready+'.tmp',JSON.stringify({id:run.id,scenario,run}),{flush:true});renameSync(ready+'.tmp',ready);
  const deadline=Date.now()+10000,word=new Int32Array(new SharedArrayBuffer(4));
  while(Date.now()<deadline)Atomics.wait(word,0,0,50);
  throw new Error('The crash fixture was not terminated at its checkpoint.');
}
function matches(run){
  const last=run.trace.at(-1);
  switch(scenario){
    case 'admission':return run.executions===0;
    case 'before-inference':return run.cursor==='infer'&&last?.nodeId==='input'&&last.state==='completed';
    case 'inference-start':return last?.nodeId==='infer'&&last.state==='running';
    case 'inference-committed':return run.cursor==='return'&&last?.nodeId==='infer'&&last.state==='completed';
    case 'completed':return run.state==='completed';
    case 'waiting':return run.state==='waiting';
    case 'wait-resumed':return run.cursor==='return'&&last?.nodeId==='wait'&&last.state==='completed';
    case 'review':return run.state==='review';
    case 'review-approved':return run.review?.decision==='approve'&&run.cursor==='return';
    case 'review-rejected':return run.review?.decision==='reject'&&run.cursor==='reject';
    case 'queued':return run.state==='queued'&&run.input.text==='queued input';
    case 'queued-cancelled':return run.state==='cancelled'&&run.input.text==='queued input';
    case 'cancelled-settling':return run.state==='cancelled'&&run.cleanupPending===true;
    case 'repeat-inference-start':return last?.nodeId==='infer'&&last.iteration===1&&last.state==='running';
    case 'repeat-condition-start':return last?.nodeId==='check'&&last.iteration===1&&last.state==='running';
    case 'repeat-next-inference':return last?.nodeId==='infer'&&last.iteration===2&&last.state==='running';
    case 'repeat-committed':return run.cursor==='return'&&run.trace.some(entry=>entry.nodeId==='repeat'&&entry.state==='completed');
    default:return false;
  }
}
const storage={read:()=>store.read(),close:()=>store.close(),write(state){
  store.write(state);
  if(armed)for(const run of Object.values(state.runs))if(matches(run))pause(run);
},writeRun(run){
  store.writeRun(run);
  if(armed&&matches(run))pause(run);
}};
const host={check:()=>{},modelInfo:async()=>({}),complete:async()=>{
  appendFileSync(effects,'original inference completed\n',{flush:true});
  if(scenario==='host-completed'||scenario==='repeat-host-completed')pause(Object.values(store.read().runs).find(run=>run.state==='running'&&run.cursor===(scenario.startsWith('repeat')?'repeat':'infer')));
  if(scenario.startsWith('queued')||scenario==='cancelled-settling')await new Promise(()=>{});
  return {text:'original committed result'};
}};
const engine=new Engine(storage,host,{replyTimeoutMs:1});armed=true;
try{
  const recovery=recoveryFile?JSON.parse(readFileSync(recoveryFile,'utf8')):null;
  const run=recovery?await engine.retry(actor,recovery.runId,recovery.mode,recovery.requestId):await engine.test(actor,definition,{text:'synthetic input'},'crash-request');
  if(scenario.startsWith('queued')){const queued=await engine.test(actor,definition,{text:'queued input'},'queued-request');if(scenario==='queued-cancelled')engine.cancel(actor,queued.id);}
  if(scenario==='cancelled-settling')engine.cancel(actor,run.id);
  if(scenario==='wait-resumed')await engine.resume(actor,run.id);
  if(scenario==='review-approved')await engine.review({...actor,human:true,source:'session-action',requester:'fixture-human'},run.id,'approve');
  if(scenario==='review-rejected')await engine.review({...actor,human:true,source:'session-action',requester:'fixture-human'},run.id,'reject');
  // Cancellation may reach its final checkpoint in a subsequent microtask.
  await new Promise(resolve=>setTimeout(resolve,100));
  throw new Error('Expected committed crash checkpoint was not reached: '+scenario);
}catch(error){console.error(error);process.exitCode=1;await engine.close();}
