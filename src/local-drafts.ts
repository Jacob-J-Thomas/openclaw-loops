import {parseDefinition,type Definition} from './graph.js';
type BrowserStore=Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>;
export type LocalDraft={definition:Definition;base:Definition|null;updatedAt:string};
const prefix=(scope:string)=>`loops-editor:v2:${scope}:`;
export function saveLocalDraft(store:BrowserStore,scope:string,definition:Definition,base:Definition|null){
  const draft:LocalDraft={definition,base,updatedAt:new Date().toISOString()};
  store.setItem(prefix(scope)+definition.id,JSON.stringify(draft));return draft;
}
export function listLocalDrafts(store:BrowserStore,scope:string):{drafts:LocalDraft[];errors:string[]}{
  const drafts:LocalDraft[]=[],errors:string[]=[];
  for(let index=0;index<store.length;index++){
    const key=store.key(index);if(!key?.startsWith(prefix(scope)))continue;
    try{const value=JSON.parse(store.getItem(key)??'');const definition=parseDefinition(value.definition);const base=value.base?parseDefinition(value.base):null;
      if(key!==prefix(scope)+definition.id||base&&base.id!==definition.id||typeof value.updatedAt!=='string')throw new Error('Draft metadata is invalid.');
      drafts.push({definition,base,updatedAt:value.updatedAt});
    }catch{errors.push(`A local draft could not be read: ${key.slice(prefix(scope).length)}. Its stored data was preserved.`);}
  }
  return {drafts:drafts.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),errors};
}
export function removeLocalDraft(store:BrowserStore,scope:string,id:string){store.removeItem(prefix(scope)+id);}
