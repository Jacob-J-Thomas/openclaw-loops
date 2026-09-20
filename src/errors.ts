import {Type} from 'typebox';
export const LoopErrorSchema=Type.Object({code:Type.String(),message:Type.String(),phase:Type.String(),nodeId:Type.Optional(Type.String()),model:Type.Optional(Type.String()),retryable:Type.Boolean(),recovery:Type.String()},{additionalProperties:false});
export type LoopErrorData = {code:string;message:string;phase:string;nodeId?:string;model?:string;retryable:boolean;recovery:string};
export class LoopError extends Error {
  constructor(readonly detail:LoopErrorData,options?:ErrorOptions){super(detail.message,options);this.name='LoopError';}
  get code(){return this.detail.code;}
}
// Classify native storage failures without putting filesystem paths, SQL or
// arbitrary trigger text into the public result. Keep the original as a cause.
export function storageError(error:unknown):unknown{
  if(error instanceof LoopError||!error||typeof error!=='object')return error;
  const native='errcode' in error&&typeof error.errcode==='number'?error.errcode&0xff:undefined;
  const os='code' in error&&typeof error.code==='string'?error.code:undefined;
  let code:string,message:string,recovery:string;
  if(native===13||os==='ENOSPC'||os==='EDQUOT'){
    code='LOOPS_STORAGE_FULL';message='Loops storage is full. The requested storage operation failed.';
    recovery='Free space or increase the profile storage quota, then explicitly retry. Inspect interrupted runs before retrying any uncertain effects.';
  }else if(native===5||native===6){
    code='LOOPS_STORAGE_BUSY';message='Loops storage is busy or locked.';
    recovery='Wait for the existing storage operation or stop the competing owner. Do not remove a live lock; explicitly retry after ownership is resolved.';
  }else if(native===8||native===14||['EACCES','EPERM','EROFS','ENOENT','ENOTDIR','EISDIR','EEXIST'].includes(os??'')){
    code='LOOPS_STORAGE_ACCESS';message='Loops cannot access writable profile storage.';
    recovery='Check the profile volume, directory permissions and read-only status, then restart the plugin and inspect recovered runs.';
  }else if(native===10||os==='EIO'){
    code='LOOPS_STORAGE_IO';message='The profile volume reported a storage I/O failure.';
    recovery='Check volume health and restart the plugin. Verify recovered state before retrying any operation with an uncertain outcome.';
  }else if(native===11||native===26){
    code='LOOPS_STORAGE_CORRUPT';message='The Loops store is corrupt or is not a SQLite database.';
    recovery='Preserve the current store for diagnosis and restore a verified, matching application/database backup. Do not overwrite it with an empty store.';
  }else if(native===19){
    code='LOOPS_STORAGE_CONFLICT';message='Loops storage rejected a conflicting write.';
    recovery='Reload the committed loop or run and inspect its revision and request identity before explicitly retrying. Contact the operator if the conflict persists.';
  }else return error;
  return new LoopError({code,message,phase:'storage',retryable:false,recovery},{cause:error});
}
// Use only for expected plugin-owned failures. Unexpected host/transport errors
// remain private; the Gateway intentionally masks thrown plugin exceptions.
export function requestError(message:string,code='LOOPS_INVALID_REQUEST',recovery='Review the request and current loop or run state before retrying.'){
  return new LoopError({code,message,phase:'operation',retryable:false,recovery});
}
export function safeFailure(error:LoopError):LoopErrorData{
  const {code,message,phase,nodeId,model,retryable,recovery}=error.detail;
  return {code,message:message.slice(0,4000),phase,retryable,recovery:recovery.slice(0,4000),...nodeId===undefined?{}:{nodeId},...model===undefined?{}:{model}};
}
// Format only the public diagnostic contract, never a native error or its cause.
export function formatFailure(detail:LoopErrorData):string{
  return [
    `[${detail.code}]: ${detail.message}`,
    `Phase: ${detail.phase}`,
    ...detail.nodeId===undefined?[]:[`Node: ${detail.nodeId}`],
    ...detail.model===undefined?[]:[`Model: ${detail.model}`],
    `Retryable: ${detail.retryable?'Yes, after the recovery step':'Resolve the failure first'}`,
    `Next step: ${detail.recovery}`,
  ].join('\n');
}
export function executionError(message:string,code='LOOPS_EXECUTION_FAILED',recovery='Inspect the failed node and its recorded inputs before explicitly retrying.'){
  return new LoopError({code,message,phase:'execution',retryable:false,recovery});
}
export function errorDetail(error:unknown, context:{phase:string;nodeId?:string;model?:string}):LoopErrorData {
  const location={phase:context.phase,...context.nodeId===undefined?{}:{nodeId:context.nodeId},...context.model===undefined?{}:{model:context.model}};
  if(error instanceof LoopError){const detail={...location,...error.detail};if(detail.nodeId===undefined)delete detail.nodeId;if(detail.model===undefined)delete detail.model;return detail;}
  // Host exceptions can embed credentials, request bodies and URLs. Classify
  // bounded data fields, including wrapped causes, but never persist their text.
  const values:Array<{code?:unknown;status?:unknown;message?:unknown}>=[],seen=new Set<object>();
  let current=error;
  for(let depth=0;depth<5&&current&&typeof current==='object'&&!seen.has(current);depth++){
    seen.add(current);
    try{
      const value=current,own=(key:string)=>Object.getOwnPropertyDescriptor(value,key)?.value;
      values.push({code:own('code'),status:own('status')??own('statusCode')??own('httpStatusCode'),message:own('message')});
      current=own('cause');
    }catch{break;}
  }
  const codes=values.map(value=>value.code),statuses=values.map(value=>value.status);
  const text=values.flatMap(value=>typeof value.message==='string'?[value.message.slice(0,4000)]:[]).join(' ');
  const has=(...wanted:string[])=>wanted.some(code=>codes.includes(code));
  const detail=(code:string,message:string,retryable:boolean,recovery:string):LoopErrorData=>({...location,code,message,retryable,recovery});
  if(has('LLM_COMPLETION_NOT_AUTHORIZED')||statuses.includes(403))return detail('HOST_POLICY_DENIED','OpenClaw or the selected provider denied this operation.',false,'Review the effective host policy and selected model/account. Loops cannot override a host denial.');
  if(statuses.includes(401)||has('invalid_api_key','authentication_error','AUTHENTICATION_FAILED')||/unauthorized|invalid.api.key|authentication.failed/i.test(text))return detail('HOST_AUTHENTICATION_FAILED','The selected model account could not authenticate.',false,'Check or reconnect the selected account in OpenClaw, then explicitly retry. Do not switch accounts silently.');
  if(has('LLM_ISOLATED_INPUT_REJECTED','LLM_ISOLATED_UNSUPPORTED')||/unsupported.*(?:parameter|setting|reasoning|model)|(?:parameter|setting|reasoning).*(?:not.supported|not.allowed)/i.test(text))return detail('HOST_SETTINGS_REJECTED','The selected runtime rejected the requested inference settings.',false,'Inspect the node model, reasoning and Advanced overrides against the selected runtime capabilities, then correct the request and explicitly retry.');
  if(has('context_length_exceeded','context_window_exceeded')||/context.{0,25}(?:exceed|overflow|too (?:long|large))/i.test(text))return detail('HOST_CONTEXT_LIMIT','The request exceeds the selected model context limit.',false,'Reduce or compact the supplied context, or deliberately select a model with sufficient context, then explicitly retry.');
  if(statuses.includes(404)||has('model_not_found'))return detail('HOST_MODEL_UNAVAILABLE','The selected model or provider endpoint was not found.',false,'Check the selected model identifier, endpoint and account access before explicitly retrying.');
  if(statuses.includes(429)||has('rate_limit_exceeded','rate_limit_error')||/rate.limit|\b429\b/i.test(text))return detail('HOST_RATE_LIMITED','The selected provider rate limit was reached.',true,'Wait for provider capacity or the account limit to reset, then explicitly retry this attempt.');
  if(has('LLM_COMPLETION_TIMEOUT','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT')||statuses.includes(408)||statuses.includes(504))return detail('HOST_TIMEOUT','The selected runtime timed out; the dispatched request may have completed.',true,'Inspect the attempt and any provider effects before explicitly retrying. Increase an explicit timeout only when appropriate.');
  if(has('LLM_COMPLETION_ABORTED','ABORT_ERR'))return detail('HOST_ABORTED','The selected runtime stopped this request; its external outcome may be uncertain.',false,'Inspect the attempt before explicitly retrying. Cancellation does not prove the provider performed no work.');
  if(/allowlist|not allowed|policy denied|permission denied|revoked/i.test(text))return detail('HOST_POLICY_DENIED','OpenClaw or the selected provider denied this operation.',false,'Review the effective host policy and selected model/account. Loops cannot override a host denial.');
  if(has('LLM_RUNTIME_UNAVAILABLE','ECONNREFUSED','ECONNRESET','ENOTFOUND','EAI_AGAIN')||statuses.some(status=>typeof status==='number'&&status>=500&&status<=599)||/unavailable|offline|overload/i.test(text))return detail('HOST_UNAVAILABLE','The selected provider or runtime is unavailable.',true,'Check the selected provider endpoint and runtime health, then explicitly retry this attempt.');
  if(has('LLM_COMPLETION_OUTPUT_REJECTED'))return detail('HOST_OUTPUT_REJECTED','The selected runtime rejected the completion output.',false,'Inspect the requested output contract and the runtime diagnostics before explicitly retrying.');
  return detail(has('LLM_COMPLETION_FAILED')?'LLM_COMPLETION_FAILED':'EXECUTION_FAILED','Execution failed in the host runtime.',false,'Inspect the failed node and the operator runtime diagnostics before explicitly retrying. Raw host error details are not included in shared run history.');
}
