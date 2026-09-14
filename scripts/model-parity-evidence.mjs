import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const fail=message=>{throw new Error(`Model parity evidence rejected: ${message}`);};
const equal=(actual,expected,label)=>{if(!isDeepStrictEqual(actual,expected))fail(`${label} did not match.`);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:undefined;
const parse=value=>{if(typeof value!=='string')return object(value);try{return object(JSON.parse(value));}catch{return undefined;}};
const texts=value=>Array.isArray(value)?value.flatMap(part=>[part?.text,part?.content].filter(item=>typeof item==='string')):[];
const receiptId=value=>{
  const direct=parse(value);if(direct?.id)return direct.id;
  for(const text of texts(value)){const parsed=parse(text);if(parsed?.id)return parsed.id;if(parsed?.result?.details?.id)return parsed.result.details.id;for(const item of parsed?.result?.content??[])if(parse(item?.text)?.id)return parse(item.text).id;}
};
const publicSource={'session-action':'session-action',command:'command',tool:'tool'};
const digest=value=>createHash('sha256').update(value).digest('hex').slice(0,12);

const nonempty=value=>typeof value==='string'&&value.length>0;
const splitModel=value=>{const slash=value.indexOf('/');return slash>0&&slash<value.length-1?[value.slice(0,slash),value.slice(slash+1)]:[];};
function invocation(call,expected,run){
  if(expected.runtimeOwner.id==='codex'){
    if(call?.name!=='loops_run')return false;
    const args=call.arguments;
    return object(args)?.slug===run.definition.slug&&equalOrFalse(args?.input,expected.input)&&args?.requestId===expected.requestId;
  }
  // OpenClaw accepts the discovered short alias, but the result below must
  // resolve it to this plugin's canonical tool identity.
  if(call?.name!=='tool_call'||!['loops_run','openclaw:loops-poc:loops_run'].includes(call.arguments?.id))return false;
  const args=call.arguments?.args;
  return object(args)?.slug===run.definition.slug&&equalOrFalse(args?.input,expected.input)&&args?.requestId===expected.requestId;
}
function equalOrFalse(actual,expected){return isDeepStrictEqual(actual,expected);}
function verifyToolHistory(history,expected,run){
  if(history?.sessionKey!==expected.sessionKey||history?.sessionId!==expected.sessionId)fail('tool history origin did not match.');
  const messages=history?.messages;if(!Array.isArray(messages))fail('tool evidence has no public chat.history messages.');
  const [provider,model]=splitModel(expected.model);
  const calls=messages.flatMap(message=>message?.role==='assistant'&&message.provider===provider&&message.model===model&&Array.isArray(message.content)?message.content.map(call=>({call,message})):[]).filter(({call})=>call?.type==='toolCall'&&nonempty(call.id));
  const matching=calls.filter(({call})=>invocation(call,expected,run));
  if(matching.length!==1)fail('tool evidence needs exactly one matching assistant invocation.');
  const {call}=matching[0];
  const results=messages.filter(message=>message?.role==='toolResult'&&message.toolCallId===call.id&&message.toolName===call.name&&message.isError!==true);
  const valid=results.filter(message=>{
    if(expected.runtimeOwner.id==='openclaw'){
      const outer=texts(message.content).map(parse).find(Boolean);
      if(outer?.tool?.id!=='openclaw:loops-poc:loops_run'||outer.tool?.name!=='loops_run'||outer?.result?.isError===true||outer?.result?.details?.id!==run.id)return false;
    }
    return receiptId(message.content)===run.id;
  });
  if(valid.length!==1)fail('tool evidence needs one matching successful tool result.');
}

/** Verify a complete public loops_inspect RunRecord against one model-parity case. */
export function verifyModelParityCase({surface,expected,run,history}={}){
  if(!Object.hasOwn(publicSource,surface))fail('surface must be session-action, command, or tool.');
  if(!object(expected)||!object(run)||!object(expected.runtimeOwner))fail('expected and full run evidence are required.');
  if(!['codex','openclaw'].includes(expected.runtimeOwner.id)||expected.runtimeOwner.kind!=='harness')fail('runtime owner must be a supported harness.');
  for(const field of ['model','agentId','sessionKey','sessionId','definitionId','nodeId','reasoning'])if(!nonempty(expected[field]))fail(`expected ${field} is required.`);
  if(!splitModel(expected.model).length||!Number.isInteger(expected.revision)||expected.revision<1||!Object.hasOwn(expected,'input')||!nonempty(run.id))fail('expected identity or run ID is invalid.');
  if(surface==='tool'&&!nonempty(expected.requestId))fail('tool cases require requestId.');
  if(run.state!=='completed'||run.source!==publicSource[surface])fail('run is not a completed record from the required surface.');
  if(run.definition?.id!==expected.definitionId||run.definition?.revision!==expected.revision||run.input===undefined)fail('pinned definition identity did not match.');
  equal(run.input,expected.input,'exact input');
  if(run.owner?.agentId!==expected.agentId||run.owner?.sessionKey!==expected.sessionKey||run.owner?.sessionId!==expected.sessionId)fail('run origin did not match.');
  if(run.executionSettings?.model!==expected.model||run.executionSettings?.reasoning!==expected.reasoning)fail('requested execution settings did not match.');
  const node=run.definition.nodes?.find(item=>item?.id===expected.nodeId&&item?.kind==='inference');
  const output=node&&run.outputs?.[node.id];
  const [provider,model]=splitModel(expected.model);
  if(!node||!object(output)||output.provider!==provider||output.model!==model||output.agentId!==expected.agentId)fail('inference-node attribution did not match.');
  if(Object.hasOwn(node,'model')||Object.hasOwn(node,'reasoning'))fail('checked inference node must inherit model and reasoning.');
  if(output.execution?.owner?.kind!==expected.runtimeOwner.kind||output.execution?.owner?.id!==expected.runtimeOwner.id)fail('inference runtime owner did not match.');
  if(output.settings?.requested?.model!==expected.model||output.settings?.requested?.reasoning!==expected.reasoning||output.settings?.applied!=='unknown')fail('inference settings evidence did not match.');
  if(surface==='tool')verifyToolHistory(history,expected,run);
  return {surface,evidenceScope:'public-backend-route',model:expected.model,runtimeOwner:expected.runtimeOwner,nodeId:expected.nodeId,definition:{id:digest(expected.definitionId),revision:expected.revision},requested:{model:expected.model,reasoning:expected.reasoning},limits:{nativeEditor:'unverified-separate',appliedReasoning:'unknown',effectiveAccount:'unknown'}};
}

/** Verify the complete six-route Codex/Ollama model-parity matrix. */
export function verifyModelParityMatrix(cases){
  if(!Array.isArray(cases)||cases.length!==6)fail('matrix requires exactly six cases.');
  const receipts=cases.map(verifyModelParityCase),runs=new Set(),routes=new Set(),definitions=new Set(),targets=new Map(),nodeIds=new Set();
  for(const item of cases){
    const provider=splitModel(item.expected.model)[0];
    if(provider!==(item.expected.runtimeOwner.id==='codex'?'openai':'ollama'))fail('matrix needs Codex/OpenAI and OpenClaw/Ollama targets.');
    if(runs.has(item.run.id))fail('matrix has a duplicate run ID.');runs.add(item.run.id);
    routes.add(`${item.expected.runtimeOwner.id}/${item.surface}`);
    definitions.add(JSON.stringify([item.expected.definitionId,item.expected.revision]));
    nodeIds.add(item.expected.nodeId);
    equal(item.run.definition,cases[0].run.definition,'pinned definition content across routes');
    const target=Object.fromEntries(['model','reasoning','agentId','sessionKey','sessionId','nodeId'].map(key=>[key,item.expected[key]]));
    const prior=targets.get(item.expected.runtimeOwner.id);
    if(prior)equal(target,prior,'selected conversation and settings across routes');
    targets.set(item.expected.runtimeOwner.id,target);
  }
  for(const route of ['codex/session-action','codex/command','codex/tool','openclaw/session-action','openclaw/command','openclaw/tool'])if(!routes.has(route))fail(`matrix is missing ${route}.`);
  if(definitions.size!==1)fail('matrix cases do not use one saved definition and revision.');
  if(nodeIds.size!==1)fail('matrix cases do not check one inherited inference node.');
  return {evidenceScope:'public-backend-routes',cases:receipts,definition:receipts[0].definition,limits:{nativeEditor:'unverified-separate',appliedReasoning:'unknown',effectiveAccount:'unknown'}};
}
