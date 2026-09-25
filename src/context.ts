import {Type,type Static} from 'typebox';
import {executionError,requestError} from './errors.js';
import {NodeValueSchema,type Json,type NodeValue,isJson} from './node-values.js';
import type {LifecycleSourceRecord} from './context-lifecycle.js';

const strict={additionalProperties:false} as const;
const bindingSegment=/^[a-z][a-z0-9_-]{0,47}$/;
const arrayIndex=/^(?:0|[1-9][0-9]*)$/;
const bytes=(value:string)=>new TextEncoder().encode(value).byteLength;
export type BindingToken={raw:string;start:number;end:number};

/** Scan {{bindings}} without treating braces inside a quoted bracket segment
 * as a token close. This keeps RFC 6901 keys such as `a}}` addressable. */
export function bindingTokens(template:string):{tokens:BindingToken[];unclosed:boolean}{
  const tokens:BindingToken[]=[];let cursor=0,unclosed=false;
  while(true){
    const start=template.indexOf('{{',cursor);if(start<0)break;
    let index=start+2,quoted=false,escaped=false,end=-1;
    for(;index<template.length;index++){
      const character=template[index];
      if(quoted){if(escaped){escaped=false;continue;}if(character==='\\'){escaped=true;continue;}if(character==='"')quoted=false;continue;}
      if(character==='"'){quoted=true;continue;}
      if(character==='}'&&template[index+1]==='}'){end=index+2;break;}
    }
    if(end<0){unclosed=true;break;}
    tokens.push({raw:template.slice(start+2,end-2),start,end});cursor=end;
  }
  return {tokens,unclosed};
}
export const ContextPathSchema=Type.String({minLength:1,maxLength:1024,description:'RFC 6901 JSON Pointer. ~0 encodes ~ and ~1 encodes /; prototype-sensitive keys are rejected.'});
export type ContextPath=Static<typeof ContextPathSchema>;
export const ContextProjectionSchema=Type.Union([
  Type.Object({mode:Type.Literal('omit')},strict),
  Type.Object({mode:Type.Literal('consume'),paths:Type.Array(ContextPathSchema,{minItems:1,uniqueItems:true,maxItems:128})},strict),
]);
export type ContextProjection={mode:'omit'}|{mode:'consume';paths:ContextPath[]};
export const ContextPatchSourceSchema=Type.Union([
  Type.Object({kind:Type.Literal('output'),path:Type.Optional(ContextPathSchema)},strict),
  Type.Object({kind:Type.Literal('literal'),value:NodeValueSchema},strict),
]);
export type ContextPatchSource={kind:'output';path?:ContextPath}|{kind:'literal';value:NodeValue};
export const ContextPatchSchema=Type.Union([
  Type.Object({mode:Type.Literal('omit')},strict),
  ...(['append','replace','merge'] as const).map(mode=>Type.Object({mode:Type.Literal(mode),target:ContextPathSchema,source:ContextPatchSourceSchema},strict)),
]);
export type ContextPatch={mode:'omit'}|{mode:'append'|'replace'|'merge';target:ContextPath;source:ContextPatchSource};
export const ContextNodeConfigSchema=Type.Object({version:Type.Literal(1),projection:ContextProjectionSchema,patch:ContextPatchSchema},strict);
export type ContextNodeConfig={version:1;projection:ContextProjection;patch:ContextPatch};
export const ContextJournalEntrySchema=Type.Object({nodeId:Type.String({minLength:1}),baseVersion:Type.Integer({minimum:0}),version:Type.Integer({minimum:1}),mode:Type.Union([Type.Literal('append'),Type.Literal('replace'),Type.Literal('merge')]),target:ContextPathSchema,source:ContextPatchSourceSchema,valueSha256:Type.String({pattern:'^[a-f0-9]{64}$'}),valueBytes:Type.Integer({minimum:0})},strict);
export type ContextJournalEntry={nodeId:string;baseVersion:number;version:number;mode:'append'|'replace'|'merge';target:ContextPath;source:ContextPatchSource;valueSha256:string;valueBytes:number};
export const ContextLifecycleSourceRecordSchema=Type.Object({id:Type.String({minLength:1,maxLength:128}),operation:Type.Union([Type.Literal('retrieve'),Type.Literal('inject'),Type.Literal('summarize'),Type.Literal('compact'),Type.Literal('reset')]),documentId:Type.String({pattern:'^[a-f0-9]{64}$'}),sha256:Type.String({pattern:'^[a-f0-9]{64}$'}),bytes:Type.Integer({minimum:0}),paths:Type.Array(ContextPathSchema,{maxItems:64}),removedPaths:Type.Array(ContextPathSchema,{maxItems:64}),absentPaths:Type.Optional(Type.Array(ContextPathSchema,{maxItems:65})),reason:Type.String({maxLength:500}),sourceVersion:Type.Integer({minimum:0}),targetVersion:Type.Integer({minimum:1}),createdAt:Type.String(),modelRequest:Type.Optional(Type.Unknown()),model:Type.Optional(Type.Unknown())},strict);
export const ContextStateSchema=Type.Object({version:Type.Integer({minimum:0}),value:Type.Record(Type.String(),Type.Unknown()),journal:Type.Array(ContextJournalEntrySchema),sources:Type.Optional(Type.Array(ContextLifecycleSourceRecordSchema))},strict);
export type ContextState={version:number;value:Record<string,Json>;journal:ContextJournalEntry[];sources?:LifecycleSourceRecord[]};

export function initialContext(input:Record<string,Json>):ContextState{return {version:0,value:{input:structuredClone(input)},journal:[]};}

export function pathSegments(path:string):string[]{
  if(!path.startsWith('/'))throw requestError(`Invalid context path: ${path}`);
  const parts=path.slice(1).split('/').map(part=>{if(/~(?:[^01]|$)/.test(part))throw requestError(`Invalid context path escape: ${path}`);return part.replace(/~1/g,'/').replace(/~0/g,'~');});
  if(parts.some(part=>['__proto__','prototype','constructor'].includes(part)))throw requestError(`Invalid context path: ${path}`);
  return parts;
}
export function assertMutableContextPath(path:string){
  if(pathSegments(path)[0]==='input')throw requestError('Context input is immutable. Choose another context target.');
}

function plain(value:unknown):value is Record<string,Json>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;}
function read(root:Json,path:string):Json{
  let value:unknown=root;
  for(const part of pathSegments(path)){
    if(Array.isArray(value)){const index=Number(part);if(!arrayIndex.test(part)||!Number.isSafeInteger(index)||index>=value.length)throw executionError(`Context path is unavailable: ${path}`,'LOOPS_CONTEXT_UNAVAILABLE');value=value[index];}
    else if(plain(value)&&Object.hasOwn(value,part))value=value[part];
    else throw executionError(`Context path is unavailable: ${path}`,'LOOPS_CONTEXT_UNAVAILABLE');
  }
  return structuredClone(value as Json);
}
function assign(root:Record<string,Json>,path:string,value:Json,create:boolean){
  const parts=pathSegments(path);if(parts[0]==='input')throw executionError('Context input is immutable. Choose another context target.','LOOPS_CONTEXT_CONFLICT');
  let parent:Json=root;
  for(const part of parts.slice(0,-1)){
    if(Array.isArray(parent)){const index=Number(part);if(!arrayIndex.test(part)||!Number.isSafeInteger(index)||index>=parent.length)throw executionError(`Context parent is unavailable: ${path}`,'LOOPS_CONTEXT_UNAVAILABLE');parent=parent[index];}
    else if(plain(parent)&&Object.hasOwn(parent,part))parent=parent[part];
    else throw executionError(`Context parent is unavailable: ${path}`,'LOOPS_CONTEXT_UNAVAILABLE');
  }
  const key=parts.at(-1)!;
  if(Array.isArray(parent)){const index=Number(key);if(!arrayIndex.test(key)||!Number.isSafeInteger(index)||(!create&&index>=parent.length)||index>parent.length)throw executionError(`Context target is unavailable: ${path}`,'LOOPS_CONTEXT_UNAVAILABLE');parent[index]=structuredClone(value);}
  else if(plain(parent)){if(!create&&!Object.hasOwn(parent,key))throw executionError(`Context target is unavailable: ${path}`,'LOOPS_CONTEXT_UNAVAILABLE');parent[key]=structuredClone(value);}
  else throw executionError(`Context parent is unavailable: ${path}`,'LOOPS_CONTEXT_UNAVAILABLE');
}
function merge(left:Json,right:Json,path:string):Json{
  if(!plain(left)||!plain(right))throw executionError(`Context merge requires JSON objects at ${path}.`,'LOOPS_CONTEXT_CONFLICT');
  const result=structuredClone(left);
  for(const [key,value] of Object.entries(right)){
    if(!Object.hasOwn(result,key)){result[key]=structuredClone(value);continue;}
    const existing=result[key];
    if(plain(existing)&&plain(value))result[key]=merge(existing,value,path);
    else if(JSON.stringify(existing)!==JSON.stringify(value))throw executionError(`Context merge conflicts at ${path}/${key}. Use replace for an explicit overwrite.`,'LOOPS_CONTEXT_CONFLICT');
  }
  return result;
}

export function projectContext(state:ContextState,config:ContextNodeConfig|undefined):Record<string,Json>|undefined{
  if(!config||config.projection.mode==='omit')return undefined;
  const projection:Record<string,Json>={};
  for(const path of config.projection.paths){
    const parts=pathSegments(path);let cursor:Json=projection;
    for(let index=0;index<parts.length-1;index++){
      const part=parts[index];
      // A selected array element is projected as a numeric-keyed object rather
      // than a sparse array. That makes `{{context.input.items.2}}` available
      // without inventing or leaking the unselected positions around it.
      if(Array.isArray(cursor)){const position=Number(part);if(!arrayIndex.test(part)||position>=cursor.length)throw executionError(`Context projection overlaps an array at ${path}.`,'LOOPS_CONTEXT_CONFLICT');cursor=cursor[position];}
      else if(plain(cursor)){const existing=Object.hasOwn(cursor,part)?cursor[part]:undefined;if(existing===undefined)cursor[part]={};cursor=cursor[part];}
      else throw executionError(`Context projection overlaps a scalar path: ${path}`,'LOOPS_CONTEXT_CONFLICT');
    }
    const last=parts.at(-1)!,value=read(state.value,path);
    if(Array.isArray(cursor)){const position=Number(last);if(!arrayIndex.test(last)||position>=cursor.length)throw executionError(`Context projection overlaps an array at ${path}.`,'LOOPS_CONTEXT_CONFLICT');cursor[position]=value;}
    else if(plain(cursor))cursor[last]=value;
    else throw executionError(`Context projection overlaps a scalar path: ${path}`,'LOOPS_CONTEXT_CONFLICT');
  }
  return structuredClone(projection);
}

export function contextPathForBinding(binding:string):string|undefined{
  const parts=contextBindingSegments(binding);if(!parts)return undefined;
  return `/${parts.map(part=>part.replace(/~/g,'~0').replace(/\//g,'~1')).join('/')}`;
}

/** Parse only the context binding namespace. Dot segments preserve the legacy
 * grammar; bracketed JSON strings make every RFC 6901 object key addressable. */
export function contextBindingSegments(binding:string):string[]|undefined{
  if(!binding.startsWith('context'))return undefined;
  const parts:string[]=[];let index='context'.length;
  while(index<binding.length){
    if(binding[index]==='.'){
      const start=++index;while(index<binding.length&&binding[index]!=='.'&&binding[index]!=='[')index++;
      const part=binding.slice(start,index);if(!bindingSegment.test(part)&&!arrayIndex.test(part))return undefined;parts.push(part);continue;
    }
    if(binding[index]!=='['||binding[index+1]!=='"')return undefined;
    const start=++index;let escaped=false,closed=false;
    while(++index<binding.length){const character=binding[index];if(escaped){escaped=false;continue;}if(character==='\\'){escaped=true;continue;}if(character==='"'){closed=true;break;}}
    if(!closed||binding[index+1]!==']')return undefined;
    let part:unknown;try{part=JSON.parse(binding.slice(start,index+1));}catch{return undefined;}
    if(typeof part!=='string'||['__proto__','prototype','constructor'].includes(part))return undefined;
    parts.push(part);index+=2;
  }
  return parts.length?parts:undefined;
}

export function contextPatchLiteral(config:ContextNodeConfig):NodeValue|undefined{
  return config.patch.mode==='omit'||config.patch.source.kind!=='literal'?undefined:config.patch.source.value;
}

export function applyContextPatch(state:ContextState,nodeId:string,config:ContextNodeConfig|undefined,output:Json,bind:(value:NodeValue)=>Json,digest:(value:string)=>string):ContextState{
  if(!config||config.patch.mode==='omit')return state;
  const {patch}=config;
  const source=patch.source.kind==='literal'?bind(patch.source.value):patch.source.path===undefined?structuredClone(output):read(output,patch.source.path);
  if(!isJson(source))throw executionError('Context patch source is not valid JSON.','LOOPS_CONTEXT_CONFLICT');
  const value=structuredClone(state.value),target=patch.target;
  if(patch.mode==='replace')assign(value,target,source,true);
  else if(patch.mode==='append'){
    const current=read(value,target);if(!Array.isArray(current))throw executionError(`Context append requires an array at ${target}.`,'LOOPS_CONTEXT_CONFLICT');
    current.push(structuredClone(source));assign(value,target,current,false);
  }else {
    const current=read(value,target);assign(value,target,merge(current,source,target),false);
  }
  const serialized=JSON.stringify(source),baseVersion=state.version,next:ContextState={version:baseVersion+1,value,journal:[...state.journal,{nodeId,baseVersion,version:baseVersion+1,mode:patch.mode,target,source:structuredClone(patch.source),valueSha256:digest(serialized),valueBytes:bytes(serialized)}],...state.sources?{sources:structuredClone(state.sources)}:{}};
  return structuredClone(next);
}

export function assertContextState(value:unknown):asserts value is ContextState{
  if(!value||typeof value!=='object')throw requestError('Invalid saved context state.');const raw=value as Record<string,unknown>;
  if(!Number.isInteger(raw.version)||(raw.version as number)<0||!plain(raw.value)||!isJson(raw.value)||!Array.isArray(raw.journal)||raw.journal.some(entry=>!entry||typeof entry!=='object'||!('nodeId' in entry)||typeof entry.nodeId!=='string'||!('baseVersion' in entry)||!Number.isInteger(entry.baseVersion)||!('version' in entry)||!Number.isInteger(entry.version)||entry.version!==entry.baseVersion+1||!('target' in entry)||typeof entry.target!=='string'||!('mode' in entry)||!['append','replace','merge'].includes(entry.mode)||!('source' in entry)||!('valueSha256' in entry)||typeof entry.valueSha256!=='string'||!('valueBytes' in entry)||!Number.isInteger(entry.valueBytes)||entry.valueBytes<0))throw requestError('Invalid saved context state.');
  const state=value as ContextState;let lastJournalVersion=0;for(const entry of state.journal){
    try{pathSegments(entry.target);if(entry.source.kind==='output'&&entry.source.path!==undefined)pathSegments(entry.source.path);}
    catch{throw requestError('Invalid saved context journal path.');}
    if(entry.source.kind!=='output'&&entry.source.kind!=='literal'||entry.source.kind==='literal'&&!isJson(entry.source.value)||entry.source.kind==='output'&&entry.source.path!==undefined&&typeof entry.source.path!=='string'||!/^([a-f0-9]{64})$/.test(entry.valueSha256))throw requestError('Invalid saved context journal provenance.');
    if(entry.version<=lastJournalVersion)throw requestError('Invalid saved context journal order.');lastJournalVersion=entry.version;
  }
  if(state.version<lastJournalVersion)throw requestError('Invalid saved context version.');
  if(state.sources!==undefined&&state.sources.some(source=>!source||typeof source!=='object'||typeof source.id!=='string'||!['retrieve','inject','summarize','compact','reset'].includes(source.operation)||typeof source.documentId!=='string'||!/^([a-f0-9]{64})$/.test(source.documentId)||typeof source.sha256!=='string'||!/^([a-f0-9]{64})$/.test(source.sha256)||!Number.isInteger(source.bytes)||source.bytes<0||!Array.isArray(source.paths)||!Array.isArray(source.removedPaths)||source.paths.some(path=>typeof path!=='string')||source.removedPaths.some(path=>typeof path!=='string')||typeof source.reason!=='string'||!Number.isInteger(source.sourceVersion)||source.sourceVersion<0||!Number.isInteger(source.targetVersion)||source.targetVersion!==source.sourceVersion+1||source.targetVersion>state.version||typeof source.createdAt!=='string'||source.model!==undefined&&!isJson(source.model)))throw requestError('Invalid saved context lifecycle source.');
  let lastSourceVersion=0;for(const source of state.sources??[]){
    try{for(const path of [...source.paths,...source.removedPaths])pathSegments(path);}catch{throw requestError('Invalid saved context lifecycle path.');}
    if(source.targetVersion<=lastSourceVersion)throw requestError('Invalid saved context lifecycle source order.');lastSourceVersion=source.targetVersion;
  }
  const changes=[...state.journal.map(entry=>({base:entry.baseVersion,version:entry.version})),...(state.sources??[]).map(source=>({base:source.sourceVersion,version:source.targetVersion}))].sort((left,right)=>left.version-right.version);
  let previous=0;for(const change of changes){if(change.base!==previous||change.version!==previous+1)throw requestError('Invalid saved context provenance order.');previous=change.version;}
  if(state.version!==previous)throw requestError('Invalid saved context version.');
}

export function contextBytes(state:ContextState,outputs:Record<string,Json>):number{return bytes(JSON.stringify({context:state,outputs}));}
