import {display,type Definition} from './graph.js';
import type {Run} from './engine.js';
import {truncateCodePoints} from './unicode.js';

// Keep large pinned graphs, repeated outputs and host audit objects out of the
// agent's context. The owner-scoped inspector retains the complete record.
export function receipt(run:Run){
  const {id,state,owner,source,requester,executions,createdAt,updatedAt,error,uncertainty,review}=run;
  const definition=describe(run.definition);
  const text=run.result===undefined?'':display(run.result);
  const clipped=new TextEncoder().encode(text).byteLength>4000;
  const pending=run.pending===undefined?undefined:truncateCodePoints(run.pending,1000);
  const models=[...new Set(Object.values(run.outputs).flatMap(value=>value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.provider==='string'&&typeof value.model==='string'?[`${value.provider}/${value.model}`]:[]))];
  return {id,state,owner,source,...requester?{requester}:{},definition:{id:definition.id,slug:definition.slug,name:definition.name,revision:definition.revision},executions,createdAt,updatedAt,models,
    ...run.result===undefined?{}:clipped?{resultPreview:truncateCodePoints(text,1000),resultTruncated:true}:{result:run.result},
    ...pending===undefined?{}:{pending,pendingTruncated:pending!==run.pending},
    ...run.cleanupPending?{cleanupPending:true}:{},...run.parentRunId?{parentRunId:run.parentRunId}:{},...run.testMode?{testMode:true}:{},...run.context?{contextVersion:run.context.version}:{},...error?{error}:{},...run.errorDetail?{errorDetail:run.errorDetail}:{},...uncertainty?{uncertainty}:{},...review?{review}:{},
    steps:run.trace.slice(-8).map(({nodeId,state,iteration})=>({nodeId,state,...iteration?{iteration}:{}})),
    inspection:'Use loops_inspect with this run ID, or open the Loops page, for the full pinned definition and node evidence.',
  };
}
export type RunReceipt=ReturnType<typeof receipt>;
export function describe(d:Definition){const {id,slug,name,description,revision,inputSchema,capabilities,limits}=d;return {id,slug,name,description,revision,inputSchema,capabilities,limits,steps:d.nodes.map(({id,kind,label})=>({id,kind,label}))};}
