import {DefinitionVersionSchemas,DefinitionFields,parseDefinition,type Definition} from './graph.js';
import {Type} from 'typebox';
import {Value} from 'typebox/value';
import {defaultBudgets} from './budgets.js';

// Local drafts capture an editor in progress: a blank name, disconnected graph,
// invalid range or empty node list must survive a browser restart. Preserve the
// renderer's structural types while deferring authoring validity to Save/Test.
const editableSchema=Type.Union(Object.values(DefinitionVersionSchemas).map(schema=>{
  const variant=structuredClone(schema);relax(variant);variant.properties.id=DefinitionFields.id;variant.properties.revision=DefinitionFields.revision;return variant;
}));
function relax(schema:unknown):void{
  if(!schema||typeof schema!=='object')return;
  const value=schema as Record<string,unknown>;
  for(const key of ['minimum','maximum','minLength','maxLength','pattern','minItems','maxItems','uniqueItems'])delete value[key];
  for(const child of Object.values(value))relax(child);
}
type BrowserStore=Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>;
export type LocalDraft={definition:Definition;base:Definition|null;updatedAt:string;storageKey:string;writerId?:string};
const prefix=(scope:string)=>`loops-editor:v2:${scope}:`;
const legacyKey=(scope:string,id:string)=>prefix(scope)+id;
const ownedKey=(scope:string,id:string,writerId:string,snapshotId:string)=>`${legacyKey(scope,id)}:writer:${writerId}:${snapshotId}`;
export function sameDefinition(left:Definition|null,right:Definition|null){
  const serialize=(value:Definition|null)=>JSON.stringify(value,(_key,item:unknown)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
  return left===right||serialize(left)===serialize(right);
}
export function definitionHasChanges(definition:Definition|null,base:Definition|null){return definition!==null&&!sameDefinition(definition,base);}
export type LocalDraftReceipt={scope:string;id:string;writerId:string;storageKey:string};
// Each editor owns a fresh writer ID and every change receives a fresh key.
// There is no shared-key compare/delete operation between browser contexts.
export function saveLocalDraft(store:BrowserStore,scope:string,writerId:string,definition:Definition,base:Definition|null,snapshotId:string=crypto.randomUUID()):LocalDraftReceipt{
  const storageKey=ownedKey(scope,definition.id,writerId,snapshotId);
  store.setItem(storageKey,JSON.stringify({definition,base,updatedAt:new Date().toISOString(),writerId,snapshotId}));
  return {scope,id:definition.id,writerId,storageKey};
}
export function syncLocalDraft(store:BrowserStore,scope:string,writerId:string,definition:Definition,base:Definition|null,previous:LocalDraftReceipt|null):LocalDraftReceipt|null{
  const ownsCurrent=previous?.scope===scope&&previous.id===definition.id&&previous.writerId===writerId;
  if(definitionHasChanges(definition,base)){
    const next=saveLocalDraft(store,scope,writerId,definition,base);
    if(ownsCurrent)store.removeItem(previous.storageKey);
    return next;
  }
  if(ownsCurrent)store.removeItem(previous.storageKey);
  return null;
}
export function ownedLocalDraftReceipt(receipt:LocalDraftReceipt|null,scope:string,writerId:string,definition:Definition){
  return receipt?.scope===scope&&receipt.writerId===writerId&&receipt.id===definition.id?receipt:null;
}
export function removeOwnedLocalDraft(store:BrowserStore,receipt:LocalDraftReceipt|null){if(!receipt)return false;store.removeItem(receipt.storageKey);return true;}
export function consumeRecoveredLocalDraft(store:BrowserStore,scope:string,draft:LocalDraft,replacement:LocalDraftReceipt){
  if(!draft.writerId||replacement.scope!==scope||replacement.id!==draft.definition.id||!draft.storageKey.startsWith(prefix(scope)))return false;
  store.removeItem(draft.storageKey);return true;
}
export function listLocalDrafts(store:BrowserStore,scope:string):{drafts:LocalDraft[];errors:string[]}{
  const drafts:LocalDraft[]=[],errors:string[]=[];
  for(let index=0;index<store.length;index++){
    const key=store.key(index);if(!key?.startsWith(prefix(scope)))continue;
    try{const value=JSON.parse(store.getItem(key)??'');if(!Value.Check(editableSchema,value.definition))throw new Error('Draft structure is unreadable.');const definition=value.definition as Definition;const base=value.base?parseDefinition(value.base,{...defaultBudgets,definitionBytes:Number.MAX_SAFE_INTEGER}):null;
      const writerId=typeof value.writerId==='string'?value.writerId:undefined,snapshotId=typeof value.snapshotId==='string'?value.snapshotId:undefined;
      if(key!==(writerId&&snapshotId?ownedKey(scope,definition.id,writerId,snapshotId):legacyKey(scope,definition.id))||base&&base.id!==definition.id||typeof value.updatedAt!=='string')throw new Error('Draft metadata is invalid.');
      drafts.push({definition,base,updatedAt:value.updatedAt,storageKey:key,...writerId?{writerId}:{}});
    }catch{errors.push(`A local draft could not be read: ${key.slice(prefix(scope).length)}. Its stored data was preserved.`);}
  }
  return {drafts:drafts.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),errors};
}
export function removeLocalDraft(store:BrowserStore,scope:string,storageKey:string){if(storageKey.startsWith(prefix(scope)))store.removeItem(storageKey);}
