import type {PluginCommandContext} from 'openclaw/plugin-sdk/plugin-entry';
import {Value} from 'typebox/value';
import {randomUUID} from 'node:crypto';
import {wireContract,OperationFailureSchema,DocumentReferenceSchema,type DocumentReference} from './wire-contract.js';
import {outputs} from './output-schemas.js';
import {parseCommand,formatRun} from './openclaw.js';
import {requestError} from './errors.js';
import type {RunReceipt} from './receipts.js';
import type {textPage} from './feature-json.js';

// Verified conversation display envelope on OpenClaw 2026.9.3. Measure the
// complete reply in UTF-16 units, including JSON escaping and instructions.
// This limits one message, never the persisted result or requested page range.
export const commandReplyLimit=8000;

type Operation=keyof typeof wireContract.operations;
type Invocation={kind:'invoke';operation:Operation;input:Record<string,unknown>;format:'json'|'run'};
type Help={kind:'help';operation?:Operation};
const operationName=(name:string):Operation=>{
  const operation=name==='read'?'load':name;
  if(!Object.hasOwn(wireContract.operations,operation))throw requestError(`Unknown Loops operation: ${name}. Use /loops help to list available commands.`);
  return operation as Operation;
};

// The JSON form follows the same public schemas as tools and the editor. The
// existing text shortcuts only translate into that contract; they do not dispatch.
export function parseCommandInvocation(context:PluginCommandContext,maxBytes:number):Invocation|Help{
  const raw=context.args?.trim()??'';
  const original=/^\/loops(?:\s+([\s\S]*))?$/i.exec(context.commandBody??'')?.[1]?.trim();
  if(original!==undefined&&original!==raw)throw requestError('OpenClaw shortened or changed this command before dispatch. No Loops operation was executed.','HOST_COMMAND_INPUT_CHANGED','Use /loops upload with smaller JSON chunks, or the editor or agent tools, then pass its staged reference. The current host command transport cannot preserve this inline input.');
  if(Buffer.byteLength(raw)>maxBytes+1000)throw requestError('Command input is too large for the configured transport budget. Use loops_upload in chunks for a large input field.');
  const [,name='help',rest='']=/^(\S+)(?:\s+([\s\S]*))?$/.exec(raw)??[];
  if(name==='help')return {kind:'help',...rest?{operation:operationName(rest)}:{}};
  const operation=operationName(name);
  let input:Record<string,unknown>,format:Invocation['format']='json';
  if(rest.trimStart().startsWith('{')){
    try{input=JSON.parse(rest) as Record<string,unknown>;}catch{throw requestError('Command arguments must contain a valid JSON object.');}
  }else if(['run','status','resume','cancel','review'].includes(operation)){
    const {op,...legacy}=parseCommand(context,maxBytes);
    if(op==='list')throw requestError('Invalid execution shortcut.');
    input=legacy;format='run';
  }else if(rest&&['load','versions','describe'].includes(operation)){
    input={[operation==='describe'?'slug':'id']:rest};
  }else{
    if(rest)throw requestError(`Use /loops ${name} <JSON object>. /loops help ${name} shows its arguments.`);
    input={};
  }
  if(['run','test','retry'].includes(operation)&&input.requestId===undefined)input.requestId=`command:${randomUUID()}`;
  if(!Value.Check(wireContract.operations[operation].input,input))throw requestError(`Arguments do not match the ${name} schema. Use /loops help ${name} for required fields and types.`);
  return {kind:'invoke',operation,input,format};
}

export function commandHelp(operation?:Operation):string{
  if(operation){
    const contract=wireContract.operations[operation];
    return `/loops ${operation==='load'?'read':operation} <JSON object>\n${contract.description}\n\nInput schema:\n${JSON.stringify(contract.input,null,2)}`;
  }
  const names=Object.keys(wireContract.operations).map(name=>name==='load'?'read':name).sort();
  return `Use /loops <operation> <JSON object>, or /loops help <operation> for its exact input schema. Omit the JSON object when no arguments are required.\n\nOperations: ${names.join(', ')}.\n\nText shortcuts: /loops run <slug> [text or JSON input] [--request-id <id>], /loops status|resume|cancel <run-id>, /loops review <run-id> approve|reject, /loops read|versions <loop-id>, /loops describe <slug>.\n\nRun, test and retry start a new admission when requestId is omitted; supply the same explicit requestId only to retry that admission. Human review requires an authenticated human. Large results return a document reference; retrieve it with /loops document {"documentId":"…","offset":0}.\n\nOpenClaw 2026.9.3 limits inline command arguments to 4,096 UTF-16 units. For larger input fields, use upload in smaller chunks whose complete JSON arguments fit that limit, then pass its reference. Loops rejects arguments changed by the host.`;
}

export function formatCommandResult(value:unknown,format:Invocation['format']='json'):string{
  if(Value.Check(OperationFailureSchema,value))return `Loops [${value.error.code}]: ${value.error.message}\n${value.error.recovery}`;
  if(Value.Check(DocumentReferenceSchema,value))return `${JSON.stringify(value,null,2)}\n\nRead the full JSON result with /loops document ${JSON.stringify({documentId:value.documentId,offset:0})}. Follow nextOffset until null.`;
  if(format==='run'&&Value.Check(outputs.receipt,value))return formatRun(value as RunReceipt);
  return typeof value==='string'?value:JSON.stringify(value,null,2);
}

export async function commandReply(value:unknown,snapshot:(value:unknown)=>Promise<DocumentReference>,format:Invocation['format']='json'):Promise<string>{
  const text=formatCommandResult(value,format);
  return text.length<=commandReplyLimit?text:formatCommandResult(await snapshot(value));
}

// Page reads must make progress directly, rather than snapshotting a page into
// another document. Preserve offsets in Unicode code points after shrinking.
export function commandPage<T extends ReturnType<typeof textPage>>(page:T):T{
  if(formatCommandResult(page).length<=commandReplyLimit)return page;
  const characters=Array.from(page.text);
  const take=(count:number):T=>({...page,text:characters.slice(0,count).join(''),nextOffset:count<characters.length?page.offset+count:page.nextOffset});
  let low=0,high=characters.length;
  while(low<high){const middle=Math.ceil((low+high)/2);if(formatCommandResult(take(middle)).length<=commandReplyLimit)low=middle;else high=middle-1;}
  if(low===0)throw requestError('The page metadata exceeds the conversation reply envelope.','LOOPS_COMMAND_REPLY_LIMIT','Retrieve this page through loops_document/loops_output or the editor.');
  return take(low);
}
