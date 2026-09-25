import {Type} from 'typebox';
import {requestError} from './errors.js';
import {dataSchemaIssues,validateDataValue,type DataSchema} from './data-schema.js';
import {assertMemoryPolicy,type MemoryPolicy} from './memory-policy.js';
import type {Json} from './node-values.js';

const strict={additionalProperties:false} as const;
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
const name=Type.String({pattern:'^(?!(?:constructor|prototype)$)[a-z][a-z0-9_-]{0,47}$'});
// The host's registration envelope is smaller than the recursive definition
// schema. The exact rule shape, prefixes, quotas and disabled/enabled union are
// checked by assertMemoryPolicy during graph validation and again at access.
export const MemoryPolicySchema=Type.Object({version:Type.Literal(1),enabled:Type.Boolean(),nodes:Type.Optional(Type.Unknown())},strict);
export const MemorySchemaEntrySchema=Type.Object({id:name,version:Type.Integer({minimum:1,maximum:1000000}),schema:Type.Unknown()},strict);
export const MemorySchemasSchema=Type.Array(MemorySchemaEntrySchema,{maxItems:64});
export type MemorySchemaEntry={id:string;version:number;schema:DataSchema};
export type MemoryDefinition={memoryPolicy?:MemoryPolicy;memorySchemas?:MemorySchemaEntry[]};

export function memorySchema(entries:MemorySchemaEntry[]|undefined,id:string,version:number):DataSchema|undefined{
  return entries?.find(entry=>entry.id===id&&entry.version===version)?.schema;
}
export function validateMemoryDefinition(definition:MemoryDefinition,version:number,nodeIds:Set<string>):string[]{
  const errors:string[]=[];
  if(version!==3){if(definition.memoryPolicy!==undefined||definition.memorySchemas!==undefined)errors.push('Memory requires schemaVersion 3.');return errors;}
  let validPolicy=false;
  if(definition.memoryPolicy!==undefined)try{assertMemoryPolicy(definition.memoryPolicy);validPolicy=true;}catch(error){errors.push(error instanceof Error?error.message:'Invalid memory policy.');}
  const entries=definition.memorySchemas??[];
  if(entries.length>64)errors.push('Memory schema catalog exceeds 64 entries.');
  const seen=new Set<string>();
  for(const entry of entries){
    const identity=`${entry.id}:${entry.version}`;
    if(seen.has(identity))errors.push(`Memory schema ${identity} is duplicated.`);seen.add(identity);
    for(const diagnostic of dataSchemaIssues(entry.schema))errors.push(`Memory schema ${identity}${diagnostic.instancePath||'/'}: ${diagnostic.message}`);
  }
  if(validPolicy&&definition.memoryPolicy?.enabled){
    for(const [nodeId,policy] of Object.entries(definition.memoryPolicy.nodes)){
      if(!nodeIds.has(nodeId))errors.push(`Memory policy names a missing Memory node: ${nodeId}.`);
      for(const scope of policy.writeScopes)if(!memorySchema(entries,scope.schemaId,scope.schemaVersion))errors.push(`Memory write scope ${scope.prefix} needs schema ${scope.schemaId} v${scope.schemaVersion}.`);
    }
  }
  return errors;
}
export function memorySchemaValidator(entries:MemorySchemaEntry[]){return {check:(id:string,version:number,value:Json)=>{
  const matches=entries.filter(entry=>entry.id===id&&entry.version===version);
  if(!matches.length||matches.some(entry=>canonical(entry.schema)!==canonical(matches[0].schema)))return false;
  const schema=matches[0].schema;
  return dataSchemaIssues(schema).length===0&&validateDataValue(schema,value).length===0;
}};}
export function assertNoMemorySchemaRedefinition(previous:MemorySchemaEntry[][],next:MemorySchemaEntry[]|undefined){
  for(const entry of next??[])for(const old of previous.flat())if(old.id===entry.id&&old.version===entry.version&&canonical(old.schema)!==canonical(entry.schema))
    throw requestError(`Memory schema ${entry.id} v${entry.version} is already saved with different rules. Publish a new schema version.`,'LOOPS_MEMORY_SCHEMA_VERSION');
}
