export type RunViewState={agentId:string;sessionKey:string;runId:string};

const key='loops-run-view:v1';
const valid=(value:unknown):value is RunViewState=>Boolean(value&&typeof value==='object'&&typeof (value as RunViewState).agentId==='string'&&typeof (value as RunViewState).sessionKey==='string'&&typeof (value as RunViewState).runId==='string'&&(value as RunViewState).agentId&&(value as RunViewState).sessionKey&&(value as RunViewState).runId);

export function readRunView(storage:Pick<Storage,'getItem'>):RunViewState|undefined{
  try{const value=JSON.parse(storage.getItem(key)??'null');return valid(value)?{agentId:value.agentId,sessionKey:value.sessionKey,runId:value.runId}:undefined;}catch{return undefined;}
}

export function saveRunView(storage:Pick<Storage,'setItem'>,value:RunViewState){try{storage.setItem(key,JSON.stringify(value));}catch{/* View restoration is optional when browser storage is unavailable. */}}
export function clearRunView(storage:Pick<Storage,'removeItem'>){try{storage.removeItem(key);}catch{/* Any retained identifiers still require current host authorization. */}}

/** A persisted view is only usable after the host supplied this current roster. */
export function acceptedRunView(value:RunViewState|undefined,agentIds:readonly string[],sessionKeys:readonly string[]){
  return value&&agentIds.includes(value.agentId)&&sessionKeys.includes(value.sessionKey)?value:undefined;
}
