import {requestError} from './errors.js';

export type MemoryWriteScope={prefix:string;schemaId:string;schemaVersion:number;retentionDays:number};
export type MemoryNodePolicy={readPrefixes:string[];writeScopes:MemoryWriteScope[];forgetPrefixes:string[]};
export type MemoryPolicy={version:1;enabled:false}|{version:1;enabled:true;nodes:Record<string,MemoryNodePolicy>};
export type MemoryOperation='consume'|'search'|'inspect'|'write'|'update'|'forget'|'retention'|'reset';

const name=/^[a-z][a-z0-9_-]{0,47}$/;
const key=/^[a-z][a-z0-9_.-]{0,63}$/;
const plain=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const fields=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).every(field=>allowed.includes(field));
const unique=(values:string[])=>new Set(values).size===values.length;
const invalid=()=>requestError('Authored memory policy is invalid.','LOOPS_MEMORY_POLICY','Inspect the saved loop revision and explicitly author valid memory scopes before enabling memory.');
export const validMemoryKey=(value:unknown):value is string=>typeof value==='string'&&key.test(value)&&!value.split('.').some(part=>!part||['__proto__','prototype','constructor'].includes(part));
export const validMemoryPrefix=(value:unknown):value is string=>validMemoryKey(value)&&!value.endsWith('..');
const validPrefixList=(value:unknown):value is string[]=>Array.isArray(value)&&value.length<=16&&value.every(validMemoryPrefix)&&unique(value);

// An absent policy is disabled. Imported definitions cannot carry a runtime
// grant: the engine must take this from its current saved authored revision.
export function assertMemoryPolicy(policy:unknown):asserts policy is MemoryPolicy{
  if(!plain(policy)||policy.version!==1||typeof policy.enabled!=='boolean')throw invalid();
  if(!policy.enabled){if(!fields(policy,['version','enabled']))throw invalid();return;}
  if(!fields(policy,['version','enabled','nodes'])||!plain(policy.nodes)||Object.keys(policy.nodes).length>128)throw invalid();
  for(const [nodeId,rule] of Object.entries(policy.nodes)){
    if(!name.test(nodeId)||!plain(rule)||!fields(rule,['readPrefixes','writeScopes','forgetPrefixes'])||
      !validPrefixList(rule.readPrefixes)||!validPrefixList(rule.forgetPrefixes)||!Array.isArray(rule.writeScopes)||rule.writeScopes.length>16)throw invalid();
    const prefixes:string[]=[];
    for(const scope of rule.writeScopes){
      if(!plain(scope)||!fields(scope,['prefix','schemaId','schemaVersion','retentionDays'])||Object.keys(scope).length!==4||
        !validMemoryPrefix(scope.prefix)||typeof scope.schemaId!=='string'||!name.test(scope.schemaId)||
        !Number.isSafeInteger(scope.schemaVersion)||Number(scope.schemaVersion)<1||Number(scope.schemaVersion)>1_000_000||
        !Number.isSafeInteger(scope.retentionDays)||Number(scope.retentionDays)<0||Number(scope.retentionDays)>3650)throw invalid();
      prefixes.push(scope.prefix as string);
    }
    if(!unique(prefixes))throw invalid();
  }
}
function matches(key:string,prefix:string){return key===prefix||key.startsWith(`${prefix}.`);}
export function memoryAccess(policy:MemoryPolicy|undefined,nodeId:string,operation:MemoryOperation,keyOrPrefix:string):MemoryWriteScope|undefined{
  if(policy===undefined||policy.enabled===false)throw requestError('Memory is disabled for this loop.','LOOPS_MEMORY_DISABLED','Explicitly author and enable a memory policy before using a memory operation.');
  assertMemoryPolicy(policy);
  const rule=policy.nodes[nodeId];
  if(!rule)throw requestError('Memory is not authored for this node.','LOOPS_MEMORY_DENIED');
  if(!validMemoryKey(keyOrPrefix))throw requestError('Memory key or prefix is invalid.','LOOPS_MEMORY_KEY');
  if(operation==='write'||operation==='update'){
    const scope=rule.writeScopes.filter(item=>matches(keyOrPrefix,item.prefix)).sort((a,b)=>b.prefix.length-a.prefix.length)[0];
    if(!scope)throw requestError('Memory write scope is not authored for this node.','LOOPS_MEMORY_DENIED');
    return scope;
  }
  const prefixes=operation==='forget'||operation==='retention'||operation==='reset'?rule.forgetPrefixes:rule.readPrefixes;
  if(!prefixes.some(prefix=>matches(keyOrPrefix,prefix)))throw requestError('Memory scope is not authored for this node.','LOOPS_MEMORY_DENIED');
  return undefined;
}
export function memoryPrefixAllowed(policy:MemoryPolicy|undefined,nodeId:string,operation:'search'|'retention'|'reset',prefix:string){
  return memoryAccess(policy,nodeId,operation,prefix);
}
