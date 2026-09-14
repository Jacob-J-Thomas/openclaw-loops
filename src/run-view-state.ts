export type RunViewState={agentId:string;sessionKey:string;runId:string};
type StorageGetter=()=>Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type RunViewResolution='pending'|'accepted'|'rejected';

const key='loops-run-view:v1';
const valid=(value:unknown):value is RunViewState=>Boolean(value&&typeof value==='object'&&typeof (value as RunViewState).agentId==='string'&&typeof (value as RunViewState).sessionKey==='string'&&typeof (value as RunViewState).runId==='string'&&(value as RunViewState).agentId&&(value as RunViewState).sessionKey&&(value as RunViewState).runId);
const browserStorage:StorageGetter=()=>sessionStorage;

export function readRunView(getStorage:StorageGetter=browserStorage):RunViewState|undefined{
  try{const value=JSON.parse(getStorage().getItem(key)??'null');return valid(value)?{agentId:value.agentId,sessionKey:value.sessionKey,runId:value.runId}:undefined;}catch{return undefined;}
}

export function saveRunView(value:RunViewState,getStorage:StorageGetter=browserStorage){try{getStorage().setItem(key,JSON.stringify(value));}catch{/* View restoration is optional when browser storage is unavailable. */}}
export function clearRunView(getStorage:StorageGetter=browserStorage){try{getStorage().removeItem(key);}catch{/* Any retained identifiers still require current host authorization. */}}

/** A persisted view is only usable after the host supplied this current roster. */
export function acceptedRunView(value:RunViewState|undefined,agentIds:readonly string[],sessionKeys:readonly string[]){
  return value&&agentIds.includes(value.agentId)&&sessionKeys.includes(value.sessionKey)?value:undefined;
}
export function resolveRunView(value:RunViewState|undefined,agentIds:readonly string[],sessionKeys:readonly string[]):RunViewResolution{
  if(!agentIds.length)return 'pending';
  return acceptedRunView(value,agentIds,sessionKeys)?'accepted':'rejected';
}
