import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const profile=process.argv[2]??'codex';
if(!['codex','ollama'].includes(profile))throw new Error('Choose codex or ollama.');
const script=profile==='codex'?'scripts/codex.sh':'scripts/dev.sh';
const directory=`evidence/release-alpha5/${profile}/transport`;mkdirSync(directory,{recursive:true});
const save=(name,value)=>writeFileSync(`${directory}/${name}.json`,JSON.stringify(value,null,2)+'\n');
function call(method,params){
  const response=spawnSync('bash',[script,'gateway','call',method,'--params',JSON.stringify(params),'--json','--timeout','60000'],{encoding:'utf8',maxBuffer:8*1024*1024});
  if(response.status!==0)throw new Error(String(response.stderr).slice(0,1500));
  const result=JSON.parse(response.stdout);if(result.ok===false)throw new Error(result.error?.message??'Gateway action failed');return result;
}
const session=call('sessions.create',{agentId:'main',label:`Loops alpha.5 transport ${randomUUID().slice(0,8)}`});save('session',session);
const module=await build({stdin:{contents:"export {createLoopsClient} from './src/feature-client.ts';",resolveDir:resolve('.'),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
const {createLoopsClient}=await import('data:text/javascript;base64,'+Buffer.from(module.outputFiles[0].contents).toString('base64'));
let requests=0;
const client=createLoopsClient({pluginId:'loops-poc',signal:new AbortController().signal,connection:{connected:true},onEvent:()=>()=>{},subscribe:()=>()=>{},request:async(method,params)=>{requests++;return call(method,params);}});
const options={agentId:'main',sessionKey:session.key},slug=`transport-${randomUUID().slice(0,8)}`;
const content='🙂\u0000"\\'.repeat(20000);
const definition={slug,name:'Large transport acceptance',description:'Synthetic alpha.5 transport check; no inference or external effects.',inputSchema:[{name:'text',label:'Text',type:'text',required:true}],nodes:[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'{{input.text}}'}],edges:[{id:'e',source:'input',target:'return',port:'next'}],layout:{},capabilities:[],limits:{maxExecutions:1000,maxOutputBytes:1024*1024}};
const created=await client.invoke('create',{definition},options);save('created',created);
const result=await client.invoke('run',{slug,input:{text:content},requestId:'large-'+randomUUID()},options);
assert.equal(result.state,'completed');assert.equal(result.resultTruncated,true);
const inspected=await client.invoke('inspect',{runId:result.id},options);assert.equal(inspected.result,content);assert.equal(inspected.input.text,content);
save('result',{receipt:result,characters:Array.from(content).length,utf8Bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex'),matches:true});
const largeDefinition={...created.record.definition,nodes:[definition.nodes[0],{id:'return',kind:'return',label:'Return',value:content}]};
const saved=await client.invoke('draft',{definition:largeDefinition,expectedRevision:1},options);assert.equal(saved.record.definition.nodes[1].value,content);
assert.equal((await client.invoke('load',{id:saved.record.definition.id},options)).definition.nodes[1].value,content);
await client.invoke('archive',{id:saved.record.definition.id,expectedRevision:2,archived:true},options);
save('acceptance',{profile,sessionKey:session.key,loopId:saved.record.definition.id,runId:result.id,requests,largeInput:true,largeDefinition:true,largeInspection:true,archived:true});
console.log(JSON.stringify({profile,runId:result.id,requests,accepted:true}));
