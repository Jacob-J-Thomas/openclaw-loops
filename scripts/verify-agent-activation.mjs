import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

// Real local Codex integration check. Only the named synthetic loop and this
// dedicated chat are used. Store reads verify results; mutations use tools.
const directory='evidence/agent-activation';
mkdirSync(directory,{recursive:true});
const mode=process.argv[2];
const slug='agent-activation-smoke-20260911';
const call=(args)=>{
  const r=spawnSync('bash',['scripts/codex.sh',...args],{encoding:'utf8',maxBuffer:8*1024*1024});
  if(r.status!==0)throw new Error(r.stderr||r.stdout);
  return r;
};
if(mode==='setup'){
  const r=call(['gateway','call','sessions.create','--params',JSON.stringify({agentId:'main',label:'Loops activation verification'}),'--json']);
  writeFileSync(`${directory}/session.json`,r.stdout);const session=JSON.parse(r.stdout);console.log(JSON.stringify({key:session.key,model:session.resolved}));
}else{
  const session=JSON.parse(readFileSync(`${directory}/session.json`,'utf8'));
  const messages={
    create:`Read the Summarize text example and create a new runnable loop based on it, named Agent activation smoke, with slug ${slug}. Then actually invoke that saved loop for this text: The community garden added twenty raised beds. Volunteers meet Saturday mornings. Produce is shared with neighbors. Use the Loops tools and any necessary tool discovery; do not read or edit files. Leave existing loops unchanged. Report the saved revision, actual loop run ID and returned result. If running, use loops_status until it finishes.`,
    manage:`Using only Loops tools, read ${slug}, edit its name to Agent activation smoke edited while keeping it enabled, then read it back. Next edit its description to Temporary draft activation check and explicitly save that revision as a disabled draft. Read that draft back. Enable that saved revision using loops_enable and read it back; then disable it using loops_enable and read it back. Do not change any other loop, do not run a model node, and do not read or edit files. Report actual revisions and activation states.`,
    invoke:`Please invoke my saved loop ${slug} to summarize: The library opens at nine. Its new reading room has twelve seats. Saturday workshops are free. Use the actual Loops tools, including any setup needed to run this loop, without reading or editing files. Report the real run ID and result; inspect status if the run is still running. Leave other loops unchanged.`,
    cleanup:`Delete only these two temporary verification loops: ${slug} and ui-activation-smoke-20260911. Read the current revision of each first and use Loops tools. Leave all other loops and all run history unchanged. Do not read or edit files.`,
  };
  if(mode==='history'){
    const r=call(['gateway','call','chat.history','--params',JSON.stringify({sessionKey:session.key,agentId:'main',limit:150}),'--json']);
    writeFileSync(`${directory}/chat-history.json`,r.stdout);console.log('Saved dedicated activation verification chat.');
  }else if(messages[mode]){
    const r=call(['agent','--agent','main','--session-key',session.key,'--message',messages[mode],'--timeout','180','--json']);
    writeFileSync(`${directory}/${mode}-agent.json`,r.stdout);writeFileSync(`${directory}/${mode}-agent.stderr.log`,r.stderr);
    const result=JSON.parse(r.stdout);console.log(JSON.stringify({ok:result.ok,status:result.status,error:result.error,payloads:result.result?.payloads??result.payloads},null,2));
    const state=JSON.parse(readFileSync('.dev-profile/codex-test/state/loops-poc/state.json','utf8'));
    const record=Object.values(state.loops).find(r=>r.definition.slug===slug)??null;
    const runs=Object.values(state.runs).filter(r=>r.owner.sessionKey===session.key);
    writeFileSync(`${directory}/after-${mode}.json`,JSON.stringify({sessionKey:session.key,record,runs},null,2)+'\n');
    console.log(JSON.stringify({id:record?.definition.id,revision:record?.definition.revision,enabledRevision:record?.enabledRevision,runs:runs.map(r=>({id:r.id,state:r.state,revision:r.definition.revision,result:r.result,error:r.error}))}));
  }else throw new Error('Use setup, create, manage, invoke, cleanup or history.');
}
