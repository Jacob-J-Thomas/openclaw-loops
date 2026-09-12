import {DefinitionSchema,parseDefinition,type Definition} from './graph.js';
import {Value} from 'typebox/value';
import {defaultBudgets} from './budgets.js';

// Local drafts capture an editor in progress: a blank name, disconnected graph,
// invalid range or empty node list must survive a browser restart. Preserve the
// renderer's structural types while deferring authoring validity to Save/Test.
const editableSchema=structuredClone(DefinitionSchema);
function relax(schema:unknown):void{
  if(!schema||typeof schema!=='object')return;
  const value=schema as Record<string,unknown>;
  for(const key of ['minimum','maximum','minLength','maxLength','pattern','minItems','maxItems','uniqueItems'])delete value[key];
  for(const child of Object.values(value))relax(child);
}
relax(editableSchema);
editableSchema.properties.id=DefinitionSchema.properties.id;
editableSchema.properties.revision=DefinitionSchema.properties.revision;
type BrowserStore=Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>;
export type LocalDraft={definition:Definition;base:Definition|null;updatedAt:string};
const prefix=(scope:string)=>`loops-editor:v2:${scope}:`;
export function sameDefinition(left:Definition|null,right:Definition|null){
  const serialize=(value:Definition|null)=>JSON.stringify(value,(_key,item:unknown)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
  return left===right||serialize(left)===serialize(right);
}
export function definitionHasChanges(definition:Definition|null,base:Definition|null){return definition!==null&&!sameDefinition(definition,base);}
export type LocalDraftReceipt={scope:string;id:string;serialized:string};
// An undo to the saved definition clears only the draft this editor last wrote.
// A different snapshot, including one written by another view, remains recoverable.
export function syncLocalDraft(store:BrowserStore,scope:string,definition:Definition,base:Definition|null,previous:LocalDraftReceipt|null):LocalDraftReceipt|null{
  if(definitionHasChanges(definition,base))return {scope,id:definition.id,serialized:JSON.stringify(saveLocalDraft(store,scope,definition,base))};
  if(previous?.scope===scope&&previous.id===definition.id&&store.getItem(prefix(scope)+definition.id)===previous.serialized)store.removeItem(prefix(scope)+definition.id);
  return null;
}
export function saveLocalDraft(store:BrowserStore,scope:string,definition:Definition,base:Definition|null){
  const draft:LocalDraft={definition,base,updatedAt:new Date().toISOString()};
  store.setItem(prefix(scope)+definition.id,JSON.stringify(draft));return draft;
}
export function listLocalDrafts(store:BrowserStore,scope:string):{drafts:LocalDraft[];errors:string[]}{
  const drafts:LocalDraft[]=[],errors:string[]=[];
  for(let index=0;index<store.length;index++){
    const key=store.key(index);if(!key?.startsWith(prefix(scope)))continue;
    try{const value=JSON.parse(store.getItem(key)??'');if(!Value.Check(editableSchema,value.definition))throw new Error('Draft structure is unreadable.');const definition=value.definition as Definition;const base=value.base?parseDefinition(value.base,{...defaultBudgets,definitionBytes:Number.MAX_SAFE_INTEGER}):null;
      if(key!==prefix(scope)+definition.id||base&&base.id!==definition.id||typeof value.updatedAt!=='string')throw new Error('Draft metadata is invalid.');
      drafts.push({definition,base,updatedAt:value.updatedAt});
    }catch{errors.push(`A local draft could not be read: ${key.slice(prefix(scope).length)}. Its stored data was preserved.`);}
  }
  return {drafts:drafts.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),errors};
}
export function removeLocalDraft(store:BrowserStore,scope:string,id:string){store.removeItem(prefix(scope)+id);}
