import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const call=(method,params)=>JSON.parse(execFileSync('bash',['scripts/dev.sh','gateway','call',method,'--params',JSON.stringify(params),'--json','--timeout','180000'],{encoding:'utf8'}));
const mode=process.argv[2];
if(mode==='create'){
  const session=call('sessions.create',{agentId:'main',label:'Loops live demo'});
  writeFileSync('evidence/acceptance-session.json',JSON.stringify(session,null,2));
  console.log({key:session.key,model:session.resolved});
}else{
  const session=JSON.parse(readFileSync('evidence/acceptance-session.json'));
  const source='A community garden added twenty raised beds. Volunteers meet on Saturday mornings. Produce is shared with neighbors.';
  const messages={user:`/loops run summarize-text ${source} --request-id acceptance-user`,agent:`Discover my enabled saved loops, choose the one for summarizing supplied text, and actually run it for this text: ${source} Report the real result and loop run ID.`};
  if(mode==='history'){
    const result=call('chat.history',{sessionKey:session.key,agentId:'main',limit:100});
    writeFileSync('evidence/chat-transcript.json',JSON.stringify(result,null,2));
    console.log(result.messages?.map(m=>({role:m.role,tool:m.toolName,content:(Array.isArray(m.content)?m.content:[{type:'text',text:String(m.content)}]).map(c=>c.type==='toolCall'?{tool:c.name,arguments:c.arguments}:c.type==='text'?{text:c.text.slice(0,500)}:{type:c.type})})).slice(-8));
  }else if(messages[mode])console.log(call('chat.send',{sessionKey:session.key,agentId:'main',message:messages[mode],idempotencyKey:`acceptance-${mode}`}));
  else throw Error('Use create, user, agent or history.');
}
