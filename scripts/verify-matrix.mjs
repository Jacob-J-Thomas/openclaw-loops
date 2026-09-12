import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const directory='evidence/release-alpha3/matrix';mkdirSync(directory,{recursive:true});
const session=JSON.parse(readFileSync('evidence/release-alpha/codex/session.json','utf8'));
function call(actionId,payload){const args=['scripts/codex.sh','gateway','call','plugins.sessionAction','--params',JSON.stringify({pluginId:'loops-poc',actionId,payload,agentId:'main',sessionKey:session.key}),'--json','--timeout','60000'];const command=spawnSync('bash',args,{encoding:'utf8',maxBuffer:16*1024*1024});if(command.status!==0)throw new Error(command.stderr);const response=JSON.parse(command.stdout);if(!response.ok)throw new Error(response.error?.message??'Request failed');return response.result;}
const entry=call('library',{}).find(loop=>loop.slug==='loops-feature-matrix');if(!entry)throw new Error('The feature-matrix loop was not found.');
const record=call('load',{id:entry.id});writeFileSync(`${directory}/definition.json`,JSON.stringify(record,null,2)+'\n');
if(!process.argv[2])console.log(JSON.stringify({id:record.definition.id,revision:record.definition.revision,enabledRevision:record.enabledRevision,inputSchema:record.definition.inputSchema,nodes:record.definition.nodes.map(node=>({id:node.id,kind:node.kind,...node.predicate?{predicate:node.predicate}:{}})),validation:call('validate',{definition:record.definition})},null,2));

if(process.argv[2]==='run'){
 const input={equals_value:'same',not_equals_value:'allowed',contains_value:'contains-needle',less_than_value:42,greater_than_value:42,truthy_value:true,optional_note:'Synthetic release validation'};
 const result=call('run',{slug:entry.slug,input,requestId:'matrix-'+randomUUID()});
 writeFileSync(`${directory}/admission.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({runId:result.id,state:result.state}));
}
if(['inspect','resume'].includes(process.argv[2])){
 const admission=JSON.parse(readFileSync(`${directory}/admission.json`,'utf8'));
 if(process.argv[2]==='resume')call('resume',{runId:admission.id});
 const run=call('inspect',{runId:admission.id});writeFileSync(`${directory}/run.json`,JSON.stringify(run,null,2)+'\n');console.log(JSON.stringify({id:run.id,state:run.state,result:run.result,error:run.error,pending:run.pending,steps:run.trace.map(t=>({node:t.nodeId,state:t.state}))}));
}
