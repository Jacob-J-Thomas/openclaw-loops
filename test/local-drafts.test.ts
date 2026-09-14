import {describe,it,expect} from 'vitest';
import {saveLocalDraft,listLocalDrafts,removeLocalDraft,ownedLocalDraftReceipt,removeOwnedLocalDraft,consumeRecoveredLocalDraft,sameDefinition,definitionHasChanges,syncLocalDraft} from '../src/local-drafts.js';
import {examples} from '../src/examples.js';
function browserStore(){const values=new Map<string,string>();return {get length(){return values.size;},key:(i:number)=>[...values.keys()][i]??null,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};}
const legacy=(store:ReturnType<typeof browserStore>,scope:string,definition=examples[0],base:typeof examples[0]|null=null)=>store.setItem(`loops-editor:v2:${scope}:${definition.id}`,JSON.stringify({definition,base,updatedAt:'2026-01-01T00:00:00.000Z'}));

describe('recoverable browser drafts',()=>{
  it('recovers unfinished edits and explicit zero from a writer-owned snapshot',()=>{
    const store=browserStore(),definition=structuredClone(examples[0]);definition.name='';definition.slug='unfinished slug';definition.nodes=[];definition.inputSchema[0].name='';definition.limits.maxExecutions=0;
    saveLocalDraft(store,'unfinished','writer-a',definition,examples[0],'one');
    const recovered=listLocalDrafts(store,'unfinished');expect(recovered.errors).toEqual([]);expect(recovered.drafts[0]).toMatchObject({definition,base:examples[0],writerId:'writer-a'});
  });
  it('recovers separate writers for one loop and preserves a legacy shared-key draft',()=>{
    const store=browserStore(),saved=examples[0],left={...saved,name:'Left tab'},right={...saved,name:'Right tab'};
    const leftReceipt=saveLocalDraft(store,'scope','writer-left',left,saved,'left'),rightReceipt=saveLocalDraft(store,'scope','writer-right',right,saved,'right');legacy(store,'scope',saved,saved);
    const drafts=listLocalDrafts(store,'scope');expect(drafts.errors).toEqual([]);expect(drafts.drafts).toHaveLength(3);expect(new Set(drafts.drafts.map(draft=>draft.storageKey))).toEqual(new Set([leftReceipt.storageKey,rightReceipt.storageKey,`loops-editor:v2:scope:${saved.id}`]));
    expect(drafts.drafts.filter(draft=>draft.definition.id===saved.id)).toHaveLength(3);
  });
  it('cleans only its prior writer snapshot through undo and redo',()=>{
    const store=browserStore(),saved=examples[0],changed={...saved,name:'Changed'},other={...examples[1],name:'Other loop'};
    saveLocalDraft(store,'scope','writer-b',other,null,'other');
    const receipt=syncLocalDraft(store,'scope','writer-a',changed,saved,null);expect(receipt).not.toBeNull();
    expect(syncLocalDraft(store,'scope','writer-a',saved,saved,receipt)).toBeNull();
    expect(listLocalDrafts(store,'scope').drafts).toMatchObject([{definition:{id:other.id,name:other.name}}]);
    expect(syncLocalDraft(store,'scope','writer-a',changed,saved,null)).not.toBeNull();
  });
  it('keeps the prior owned snapshot and another writer when replacement storage fails',()=>{
    const store=browserStore(),saved=examples[0],older={...saved,name:'Older'},newer={...saved,name:'Newer'},other={...saved,name:'Other writer'};
    const prior=saveLocalDraft(store,'scope','writer-a',older,saved,'older');saveLocalDraft(store,'scope','writer-b',other,saved,'other');
    const setItem=store.setItem;store.setItem=()=>{throw Error('quota exceeded');};
    expect(()=>syncLocalDraft(store,'scope','writer-a',newer,saved,prior)).toThrow('quota exceeded');store.setItem=setItem;
    expect(listLocalDrafts(store,'scope').drafts.map(draft=>draft.definition.name)).toEqual(expect.arrayContaining([older.name,other.name]));
  });
  it('cannot remove a second writer interleaved between ownership read and delete',()=>{
    const store=browserStore(),saved=examples[0],older={...saved,name:'Older save'},newer={...saved,name:'Second writer'};
    const saving=saveLocalDraft(store,'scope','writer-a',older,saved,'older');
    const admitted=ownedLocalDraftReceipt(saving,'scope','writer-a',older);expect(admitted).toEqual(saving);
    const other=saveLocalDraft(store,'scope','writer-b',newer,saved,'newer');
    expect(removeOwnedLocalDraft(store,admitted)).toBe(true);
    expect(listLocalDrafts(store,'scope').drafts).toMatchObject([{definition:{name:newer.name},storageKey:other.storageKey}]);
  });
  it('keeps a later same-tab edit through save cleanup and the following clean effect',()=>{
    const store=browserStore(),saved=examples[0],older={...saved,name:'Older save'},newer={...saved,name:'Later same tab'};
    const saving=syncLocalDraft(store,'scope','writer-a',older,saved,null);expect(saving).not.toBeNull();
    const current=syncLocalDraft(store,'scope','writer-a',newer,saved,saving);expect(current).not.toBeNull();
    expect(removeOwnedLocalDraft(store,saving)).toBe(true);
    expect(syncLocalDraft(store,'scope','writer-a',saved,saved,null)).toBeNull();
    expect(listLocalDrafts(store,'scope').drafts[0]).toMatchObject({definition:{name:newer.name},storageKey:current!.storageKey});
  });
  it('never automatically deletes legacy shared keys and keeps scopes isolated',()=>{
    const store=browserStore(),saved=examples[0],changed={...saved,name:'Current writer'};legacy(store,'scope',saved,saved);legacy(store,'other',changed,null);
    const receipt=syncLocalDraft(store,'scope','writer-a',changed,saved,null);expect(receipt).not.toBeNull();
    syncLocalDraft(store,'scope','writer-a',saved,saved,receipt);
    expect(listLocalDrafts(store,'scope').drafts).toHaveLength(1);expect(listLocalDrafts(store,'other').drafts).toHaveLength(1);
  });
  it('consumes a recovered writer snapshot only after its replacement exists',()=>{
    const store=browserStore(),saved=examples[0],recovered={...saved,name:'Recovered'},edited={...saved,name:'Recovered edit'},other={...saved,name:'Other writer'};
    const source=saveLocalDraft(store,'scope','writer-source',recovered,saved,'source');saveLocalDraft(store,'scope','writer-other',other,saved,'other');
    const row=listLocalDrafts(store,'scope').drafts.find(draft=>draft.storageKey===source.storageKey)!;
    const replacement=syncLocalDraft(store,'scope','writer-recover',edited,saved,null);expect(replacement).not.toBeNull();
    expect(consumeRecoveredLocalDraft(store,'scope',row,replacement!)).toBe(true);
    saveLocalDraft(store,'scope','writer-source',{...saved,name:'Source later'},saved,'later');consumeRecoveredLocalDraft(store,'scope',row,replacement!);
    expect(listLocalDrafts(store,'scope').drafts.map(draft=>draft.definition.name)).toEqual(expect.arrayContaining([edited.name,other.name,'Source later']));
  });
  it('keeps a recovered snapshot when replacement persistence fails',()=>{
    const store=browserStore(),saved=examples[0],recovered={...saved,name:'Recovered'},edited={...saved,name:'Edited'};
    const source=saveLocalDraft(store,'scope','writer-source',recovered,saved,'source'),row=listLocalDrafts(store,'scope').drafts[0]!;
    const setItem=store.setItem;store.setItem=()=>{throw Error('quota exceeded');};expect(()=>syncLocalDraft(store,'scope','writer-recover',edited,saved,null)).toThrow();store.setItem=setItem;
    expect(row.storageKey).toBe(source.storageKey);expect(listLocalDrafts(store,'scope').drafts[0]).toMatchObject({storageKey:source.storageKey,definition:{name:recovered.name}});
  });
  it('does not consume a pending recovery when a different loop is persisted',()=>{
    const store=browserStore(),saved=examples[0],recovered={...saved,name:'Recovery after failed persistence'};
    const source=saveLocalDraft(store,'scope','writer-source',recovered,saved,'source'),row=listLocalDrafts(store,'scope').drafts[0]!;
    const different=saveLocalDraft(store,'scope','writer-recover',examples[1],null,'other-loop');
    expect(consumeRecoveredLocalDraft(store,'scope',row,different)).toBe(false);
    expect(listLocalDrafts(store,'scope').drafts.find(draft=>draft.storageKey===source.storageKey)?.definition).toEqual(recovered);
  });
  it('makes deliberate discard target the selected recovery row only',()=>{
    const store=browserStore(),saved=examples[0],one={...saved,name:'One'},two={...saved,name:'Two'};
    saveLocalDraft(store,'scope','writer-a',one,saved,'one');saveLocalDraft(store,'scope','writer-b',two,saved,'two');
    const [first,second]=listLocalDrafts(store,'scope').drafts;removeLocalDraft(store,'scope',first!.storageKey);
    expect(listLocalDrafts(store,'scope').drafts).toEqual([second]);
  });
  it('still recognizes restored definitions regardless of object key order',()=>{
    const saved=structuredClone(examples[0]),reordered=JSON.parse(JSON.stringify(saved,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).reverse()):value));
    expect(sameDefinition(saved,reordered)).toBe(true);expect(definitionHasChanges(reordered,saved)).toBe(false);expect(definitionHasChanges(saved,null)).toBe(true);
  });
  it('retains unreadable data and distinguishes explicit Advanced zero from inheritance',()=>{
    const store=browserStore(),saved=structuredClone(examples[0]);if(saved.nodes[1].kind!=='inference')throw Error();saved.nodes[1].advanced={temperature:0,maxTokens:128};
    saveLocalDraft(store,'scope','writer-a',saved,examples[0],'advanced');store.setItem('loops-editor:v2:scope:damaged','{');
    const found=listLocalDrafts(store,'scope');expect(found.errors[0]).toContain('preserved');expect(store.getItem('loops-editor:v2:scope:damaged')).toBe('{');
    expect(found.drafts[0]?.definition.nodes[1]).toMatchObject({advanced:{temperature:0,maxTokens:128}});
    const inherited=structuredClone(saved);if(inherited.nodes[1].kind!=='inference')throw Error();delete inherited.nodes[1].advanced;
    expect(definitionHasChanges(inherited,saved)).toBe(true);
  });
});
