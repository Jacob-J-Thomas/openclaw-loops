import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

// Live check against the isolated Codex profile; only this dedicated chat and
// the explicitly named temporary draft are used as evidence. No model fakes.
const directory='evidence/agent-authoring';
const session=JSON.parse(readFileSync(`${directory}/session.json`,'utf8'));
const slug='agent-authoring-smoke-20260911';
const messages={
  create:`Show me all saved loops, including disabled drafts. Read the Summarize text loop, then create a new draft based on it named Agent authoring smoke with slug ${slug} and description Temporary test of agent authoring. Leave it disabled and do not execute it. Leave all existing loops unchanged. Use the Loops tools, without reading or editing files. Report the saved ID and revision.`,
  edit:`Read the draft with slug ${slug} and edit its inference prompt to: Return exactly three bullet points that summarize the following text: {{input.text}}. Change its name to Agent authoring smoke edited. Preserve all other definition fields. Save the new disabled revision using Loops tools. Do not enable or execute it, and do not read or edit files. Report its actual saved ID and revision.`,
  delete:`Delete only the temporary draft with slug ${slug} using Loops tools. Read its current revision first, perform the deletion, then list the library to verify it is gone. Leave every other loop and all run history unchanged. Do not read or edit files. Report the actual deletion result.`,
};
const mode=process.argv[2];
if(mode==='history'){
  const r=spawnSync('bash',['scripts/codex.sh','gateway','call','chat.history','--params',JSON.stringify({sessionKey:session.key,agentId:'main',limit:100}),'--json'],{encoding:'utf8',maxBuffer:8*1024*1024});
  if(r.status!==0)throw new Error(r.stderr);
  writeFileSync(`${directory}/chat-history.json`,r.stdout);
  console.log('Saved the dedicated authoring test chat history.');
}else if(messages[mode]){
  const r=spawnSync('bash',['scripts/codex.sh','agent','--agent','main','--session-key',session.key,'--message',messages[mode],'--timeout','120','--json'],{encoding:'utf8',maxBuffer:8*1024*1024});
  writeFileSync(`${directory}/${mode}-agent.json`,r.stdout);writeFileSync(`${directory}/${mode}-agent.stderr.log`,r.stderr);
  const result=r.stdout.trim()?JSON.parse(r.stdout):{};
  console.log(JSON.stringify({ok:result.ok,status:result.status,error:result.error,payloads:result.result?.payloads??result.payloads},null,2));
  if(r.status!==0)process.exit(r.status??1);
  const state=JSON.parse(readFileSync('.dev-profile/codex-test/state/loops-poc/state.json','utf8'));
  const record=Object.values(state.loops).find(r=>r.definition.slug===slug)??null;
  writeFileSync(`${directory}/after-${mode}.json`,JSON.stringify({sessionKey:session.key,record},null,2)+'\n');
  console.log(JSON.stringify({savedId:record?.definition.id,revision:record?.definition.revision,enabledRevision:record?.enabledRevision,exists:!!record}));
}else throw new Error('Use create, edit, delete or history. Create a dedicated session in evidence/agent-authoring/session.json first.');
