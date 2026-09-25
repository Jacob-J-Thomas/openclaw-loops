import {Type,type Static} from 'typebox';
import {LoopError,executionError,requestError} from './errors.js';
import {ContextPathSchema,assertMutableContextPath,pathSegments,type ContextPath,type ContextState} from './context.js';
import {NodeValueSchema,type Json,isJson} from './node-values.js';
import {AdvancedSchema,ReasoningSchema} from './inference-settings.js';

const strict={additionalProperties:false} as const;
export const LifecycleOperationSchema=Type.Union([Type.Literal('retrieve'),Type.Literal('inject'),Type.Literal('summarize'),Type.Literal('compact'),Type.Literal('reset')]);
export type LifecycleOperation='retrieve'|'inject'|'summarize'|'compact'|'reset';
export const LifecycleSourceSchema=Type.Union([
  Type.Object({kind:Type.Literal('initial')},strict),
  Type.Object({kind:Type.Literal('retained'),sourceId:Type.String({minLength:1,maxLength:128}),format:Type.Optional(Type.Union([Type.Literal('snapshot'),Type.Literal('document')]))},strict),
]);
export type LifecycleSource={kind:'initial'}|{kind:'retained';sourceId:string;format?:'snapshot'|'document'};
export const ContextLifecycleSchema=Type.Object({
  operation:LifecycleOperationSchema,target:ContextPathSchema,paths:Type.Array(ContextPathSchema,{minItems:1,maxItems:64,uniqueItems:true}),
  source:Type.Optional(LifecycleSourceSchema),value:Type.Optional(NodeValueSchema),instructions:Type.Optional(NodeValueSchema),reason:Type.Optional(Type.String({maxLength:500})),
  model:Type.Optional(Type.String({minLength:1,maxLength:300})),agentId:Type.Optional(Type.String({pattern:'^(?!(?:constructor|prototype)$)[a-z][a-z0-9_-]{0,47}$'})),reasoning:Type.Optional(ReasoningSchema),advanced:Type.Optional(AdvancedSchema),
},strict);
export type ContextLifecycle={operation:LifecycleOperation;target:ContextPath;paths:ContextPath[];source?:LifecycleSource;value?:import('./node-values.js').NodeValue;instructions?:import('./node-values.js').NodeValue;reason?:string;model?:string;agentId?:string;reasoning?:Static<typeof ReasoningSchema>;advanced?:Static<typeof AdvancedSchema>};
export type LifecycleSourceRecord={id:string;operation:LifecycleOperation;documentId:string;sha256:string;bytes:number;paths:ContextPath[];removedPaths:ContextPath[];absentPaths?:ContextPath[];reason:string;sourceVersion:number;targetVersion:number;createdAt:string;modelRequest?:Json;model?:Json};

const plain=(value:unknown):value is Record<string,Json>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const index=/^(?:0|[1-9][0-9]*)$/;
function read(root:Json,path:string):Json{let value:unknown=root;for(const part of pathSegments(path)){if(Array.isArray(value)){if(!index.test(part)||Number(part)>=value.length)throw executionError(`Context path is unavailable: ${path}`,'LOOPS_CONTEXT_UNAVAILABLE');value=value[Number(part)];}else if(plain(value)&&Object.hasOwn(value,part))value=value[part];else throw executionError(`Context path is unavailable: ${path}`,'LOOPS_CONTEXT_UNAVAILABLE');}return structuredClone(value as Json);}
function replace(root:Record<string,Json>,path:string,value:Json){const parts=pathSegments(path);if(parts[0]==='input')throw executionError('Context input is immutable. Choose another context target.','LOOPS_CONTEXT_CONFLICT');let parent:Json=root;for(const part of parts.slice(0,-1)){if(Array.isArray(parent)&&index.test(part)&&Number(part)<parent.length)parent=parent[Number(part)];else if(plain(parent)&&Object.hasOwn(parent,part))parent=parent[part];else throw executionError(`Context parent is unavailable: ${path}`,'LOOPS_CONTEXT_UNAVAILABLE');}const last=parts.at(-1)!;if(Array.isArray(parent)){if(!index.test(last)||Number(last)>parent.length)throw executionError(`Context target is unavailable: ${path}`,'LOOPS_CONTEXT_UNAVAILABLE');parent[Number(last)]=structuredClone(value);}else if(plain(parent))parent[last]=structuredClone(value);else throw executionError(`Context parent is unavailable: ${path}`,'LOOPS_CONTEXT_UNAVAILABLE');}
function remove(root:Record<string,Json>,path:string){const parts=pathSegments(path);if(parts[0]==='input')throw executionError('Context input is immutable.','LOOPS_CONTEXT_CONFLICT');let parent:Json=root;for(const part of parts.slice(0,-1)){if(Array.isArray(parent)&&index.test(part)&&Number(part)<parent.length)parent=parent[Number(part)];else if(plain(parent)&&Object.hasOwn(parent,part))parent=parent[part];else throw executionError(`Context path is unavailable: ${path}`,'LOOPS_CONTEXT_UNAVAILABLE');}const last=parts.at(-1)!;if(Array.isArray(parent)){if(!index.test(last)||Number(last)>=parent.length)throw executionError(`Context path is unavailable: ${path}`,'LOOPS_CONTEXT_UNAVAILABLE');parent.splice(Number(last),1);}else if(plain(parent)&&Object.hasOwn(parent,last))delete parent[last];else throw executionError(`Context path is unavailable: ${path}`,'LOOPS_CONTEXT_UNAVAILABLE');}
export function selected(state:ContextState,paths:ContextPath[]):Record<string,Json>{const result:Record<string,Json>={};for(const path of paths)result[path]=read(state.value,path);return result;}
export function selectedIfPresent(state:ContextState,paths:ContextPath[]):{values:Record<string,Json>;absentPaths:ContextPath[]}{
  const values:Record<string,Json>={},absentPaths:ContextPath[]=[];
  for(const path of [...new Set(paths)]){
    try{values[path]=read(state.value,path);}catch(error){if(error instanceof LoopError&&error.detail.code==='LOOPS_CONTEXT_UNAVAILABLE')absentPaths.push(path);else throw error;}
  }
  return {values,absentPaths};
}
/** Lifecycle snapshots store selected paths as exact keys. Ordinary owner-scoped
 * documents retain their original JSON tree; both routes expose only the
 * explicitly authored selection. DocumentStore performs owner/integrity checks. */
export function selectRetainedSource(value:unknown,paths:ContextPath[],format:'snapshot'|'document'):Record<string,Json>{
  if(!isJson(value))throw executionError('Retained context source is not valid JSON.','LOOPS_CONTEXT_CONFLICT');
  let snapshot:Record<string,Json>|undefined;
  if(format==='snapshot'){
    if(!plain(value))throw executionError('Retained context snapshot is unavailable.','LOOPS_CONTEXT_SOURCE_UNAVAILABLE');
    snapshot=value;
  }
  const result:Record<string,Json>={};
  for(const path of paths){
    pathSegments(path);
    if(snapshot){
      if(!Object.hasOwn(snapshot,path))throw executionError(`Retained context path is unavailable: ${path}`,'LOOPS_CONTEXT_SOURCE_UNAVAILABLE');
      result[path]=structuredClone(snapshot[path]);
    }else result[path]=read(value,path);
  }
  return result;
}
export function lifecycleMutation(state:ContextState,target:ContextPath,value:Json,removedPaths:ContextPath[],source:Omit<LifecycleSourceRecord,'targetVersion'>):ContextState{
  const next=structuredClone(state),before=state.version;
  if(source.sourceVersion!==before)throw requestError('Lifecycle source version does not match the current context.');
  // Removing a later array index first keeps selected positions stable. A
  // deeper child must precede its parent; overlapping paths are rejected at
  // authoring time, so this is deterministic for valid graphs.
  const removals=[...removedPaths].sort((left,right)=>{const a=pathSegments(left),b=pathSegments(right);if(a.length!==b.length)return b.length-a.length;const parentA=a.slice(0,-1).join('/'),parentB=b.slice(0,-1).join('/');if(parentA===parentB&&index.test(a.at(-1)!)&&index.test(b.at(-1)!))return Number(b.at(-1)!)-Number(a.at(-1)!);return left.localeCompare(right);});
  for(const path of removals){if(path===target||target.startsWith(`${path}/`)||path.startsWith(`${target}/`))throw requestError('Lifecycle removal and target paths overlap.');remove(next.value,path);}replace(next.value,target,value);next.version=before+1;next.sources??=[];next.sources.push({...source,targetVersion:next.version});return next;
}
export function retained(state:ContextState,id:string):LifecycleSourceRecord{const source=state.sources?.find(item=>item.id===id);if(!source)throw executionError('Retained context source is unavailable.','LOOPS_CONTEXT_SOURCE_UNAVAILABLE');return source;}
export function validateLifecycle(config:ContextLifecycle){
  for(const path of [config.target,...config.paths])pathSegments(path);
  assertMutableContextPath(config.target);
  if(['retrieve','reset'].includes(config.operation)&&!config.source)throw requestError(`${config.operation} requires an explicit lifecycle source.`);
  if(config.operation==='inject'&&config.value===undefined&&!config.source)throw requestError('Inject requires an explicit value or retained source.');
  if(config.source&&config.value!==undefined)throw requestError('Choose one lifecycle source or authored value, not both.');
  if(config.operation!=='inject'&&config.value!==undefined)throw requestError('Only inject accepts an authored value.');
  if(['summarize','compact'].includes(config.operation)&&config.instructions===undefined)throw requestError(`${config.operation} requires authored instructions.`);
  if(['summarize','compact'].includes(config.operation)&&config.source)throw requestError(`${config.operation} cannot replace its explicit model completion with a retained source.`);
  if(config.operation==='compact'){
    for(const path of config.paths)assertMutableContextPath(path);
    if(config.paths.some((path,index)=>config.paths.some((other,otherIndex)=>index!==otherIndex&&(path.startsWith(`${other}/`)||other.startsWith(`${path}/`)))))throw requestError('Compact paths cannot overlap.');
    if(config.paths.some(path=>path===config.target||config.target.startsWith(`${path}/`)||path.startsWith(`${config.target}/`)))throw requestError('Compact target must not overlap a removed path.');
  }
  if(['compact','reset'].includes(config.operation)&&!config.reason?.trim())throw requestError(`${config.operation} requires an authored reason for its lossy change.`);
}
export const lifecycleValue=(value:unknown):Json=>{if(!isJson(value))throw executionError('Lifecycle source is not valid JSON.','LOOPS_CONTEXT_CONFLICT');return structuredClone(value);};
