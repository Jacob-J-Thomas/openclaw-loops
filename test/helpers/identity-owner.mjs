// Disposable process fixture with real plugin storage/engine and a counted fake
// host capability. Locale changes never modify the application's configuration.
import assert from 'node:assert/strict';
import {appendFileSync,existsSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const [bundle,file,effects,stage]=process.argv.slice(2);
const {Engine,SqliteStorage}=await import(pathToFileURL(bundle).href);
const actor={agentId:'main',sessionKey:'agent:main:identity-locale',sessionId:'identity-locale',source:'tool',human:false,check:()=>{}};
const host={check:()=>{},complete:async()=>{throw Error('No inference in this fixture');},modelInfo:async()=>{appendFileSync(effects,'effect\n');return {model:'fixture'};}};
const engine=new Engine(new SqliteStorage(file),host);
const slug='locale-identity',input={data:{'é':0,'e\u0301':false,'ä':1,z:[0,false,null]}},reordered={data:{z:[0,false,null],'ä':1,'e\u0301':false,'é':0}},changed={data:{...input.data,'é':false}};
let result;
try{
  if(stage==='create'){
    engine.create(actor,{slug,name:'Locale identity',description:'Synthetic identity qualification',inputSchema:[{name:'data',label:'Data',type:'json',required:true}],capabilities:['model-info'],nodes:[{id:'input',kind:'input',label:'Input'},{id:'model',kind:'action',label:'Model',capability:'model-info'},{id:'return',kind:'return',label:'Return',value:'{{input.data}}'}],edges:[{id:'a',source:'input',target:'model',port:'next'},{id:'b',source:'model',target:'return',port:'next'}],layout:{},limits:{maxExecutions:1000,maxOutputBytes:1048576}});
    result=await engine.run(actor,slug,input,'stable');assert.equal(result.state,'completed');assert.equal(result.requestFingerprintVersion,2);
  }else if(stage==='replay'){
    result=await engine.run(actor,slug,reordered,'stable');assert.equal(result.state,'completed');
    await assert.rejects(engine.run(actor,slug,changed,'stable'),/conflict/);
  }else if(stage==='retire'){
    const preview=engine.retention(actor,{keepLatest:0});assert.equal(preview.candidates.length,1);engine.retention(actor,preview.policy,preview.planId);
    result={removed:preview.candidates[0].id};
  }else{
    await assert.rejects(engine.run(actor,slug,reordered,'stable'),error=>error.code==='LOOPS_HISTORY_REMOVED');
    await assert.rejects(engine.run(actor,slug,changed,'stable'),/conflict/);
    result=await engine.run(actor,slug,reordered,'intentional');assert.equal(result.state,'completed');
  }
}finally{await engine.close();}
process.stdout.write(JSON.stringify({stage,locale:Intl.Collator().resolvedOptions().locale,id:result.id??result.removed,fingerprint:result.requestFingerprint,effects:existsSync(effects)?readFileSync(effects,'utf8').trim().split('\n').length:0})+'\n');
