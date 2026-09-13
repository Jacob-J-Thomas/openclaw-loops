import {describe,it,expect} from 'vitest';
import {saveLocalDraft,listLocalDrafts,removeLocalDraft,ownedLocalDraftReceipt,removeOwnedLocalDraft,sameDefinition,definitionHasChanges,syncLocalDraft} from '../src/local-drafts.js';
import {examples} from '../src/examples.js';
function browserStore(){const values=new Map<string,string>();return {get length(){return values.size;},key:(i:number)=>[...values.keys()][i]??null,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};}
describe('recoverable browser drafts',()=>{
  it('recovers unfinished edits even while the definition fails save validation',()=>{
    const store=browserStore(),definition=structuredClone(examples[0]);definition.name='';definition.slug='unfinished slug';definition.nodes=[];definition.inputSchema[0].name='';definition.limits.maxExecutions=0;
    saveLocalDraft(store,'unfinished',definition,examples[0]);
    const recovered=listLocalDrafts(store,'unfinished');expect(recovered.errors).toEqual([]);expect(recovered.drafts[0]).toMatchObject({definition,base:examples[0]});
  });
  it('keeps separate loop and conversation drafts, preserving base revision and explicit zero',()=>{
    const store=browserStore(),definition=structuredClone(examples[0]);if(definition.nodes[1].kind!=='inference')throw Error();definition.nodes[1].advanced={temperature:0};
    saveLocalDraft(store,'session-a',definition,examples[0]);saveLocalDraft(store,'session-a',examples[1],examples[1]);saveLocalDraft(store,'session-b',{...definition,name:'Other conversation'},null);
    const found=listLocalDrafts(store,'session-a');expect(found.errors).toEqual([]);expect(found.drafts).toHaveLength(2);expect(found.drafts.find(d=>d.definition.id===definition.id)).toMatchObject({base:examples[0],definition:{nodes:definition.nodes}});
    removeLocalDraft(store,'session-a',definition.id);expect(listLocalDrafts(store,'session-a').drafts).toHaveLength(1);expect(listLocalDrafts(store,'session-b').drafts[0].definition.name).toBe('Other conversation');
  });
  it('retains unreadable data while recovering independent valid drafts',()=>{
    const store=browserStore();saveLocalDraft(store,'scope',examples[0],null);store.setItem('loops-editor:v2:scope:damaged','{');
    const found=listLocalDrafts(store,'scope');expect(found.drafts).toHaveLength(1);expect(found.errors[0]).toContain('preserved');expect(store.getItem('loops-editor:v2:scope:damaged')).toBe('{');
  });
  it('recognizes a restored definition regardless of object key order while preserving explicit zero',()=>{
    const saved=structuredClone(examples[0]);if(saved.nodes[1].kind!=='inference')throw Error();saved.nodes[1].advanced={temperature:0,maxTokens:128};
    const reordered=JSON.parse(JSON.stringify(saved,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).reverse()):value));
    expect(sameDefinition(saved,reordered)).toBe(true);expect(definitionHasChanges(reordered,saved)).toBe(false);
    const inherited=structuredClone(saved);if(inherited.nodes[1].kind!=='inference')throw Error();delete inherited.nodes[1].advanced;
    expect(definitionHasChanges(inherited,saved)).toBe(true);expect(definitionHasChanges(null,saved)).toBe(false);expect(definitionHasChanges(saved,null)).toBe(true);
  });
  it('removes its own undone draft, recreates redo changes, and keeps other loops and conversations',()=>{
    const store=browserStore(),saved=structuredClone(examples[0]);if(saved.nodes[1].kind!=='inference')throw Error();saved.nodes[1].advanced={temperature:0,maxTokens:128};
    const inherited=structuredClone(saved);if(inherited.nodes[1].kind!=='inference')throw Error();delete inherited.nodes[1].advanced;
    saveLocalDraft(store,'scope',examples[1],null);saveLocalDraft(store,'other',inherited,saved);
    const receipt=syncLocalDraft(store,'scope',inherited,saved,null);expect(receipt).not.toBeNull();
    expect(listLocalDrafts(store,'scope').drafts).toHaveLength(2);
    expect(syncLocalDraft(store,'scope',saved,saved,receipt)).toBeNull();
    expect(listLocalDrafts(store,'scope').drafts.map(row=>row.definition.id)).toEqual([examples[1].id]);expect(listLocalDrafts(store,'other').drafts).toHaveLength(1);
    const redone=syncLocalDraft(store,'scope',inherited,saved,null);expect(redone).not.toBeNull();
    expect(listLocalDrafts(store,'scope').drafts.find(row=>row.definition.id===saved.id)?.definition).toEqual(inherited);
  });
  it('preserves an existing or subsequently replaced draft when a clean editor has not written it',()=>{
    const store=browserStore(),saved=examples[0],mine={...saved,name:'My temporary edit'},other={...saved,name:'Independent newer draft'};
    saveLocalDraft(store,'scope',other,saved);syncLocalDraft(store,'scope',saved,saved,null);
    expect(listLocalDrafts(store,'scope').drafts[0].definition.name).toBe(other.name);
    const receipt=syncLocalDraft(store,'scope',mine,saved,null);saveLocalDraft(store,'scope',other,saved);
    syncLocalDraft(store,'scope',saved,saved,receipt);expect(listLocalDrafts(store,'scope').drafts[0].definition.name).toBe(other.name);
  });
  it('removes only the snapshot owned when a successful save began',()=>{
    const store=browserStore(),saved=examples[0],mine={...saved,name:'Saved from this tab'},other={...examples[1],name:'Other loop'},otherScope={...saved,name:'Other scope'};
    saveLocalDraft(store,'scope',other,null);saveLocalDraft(store,'other-scope',otherScope,null);
    const receipt=syncLocalDraft(store,'scope',mine,saved,null);expect(receipt).not.toBeNull();
    expect(removeOwnedLocalDraft(store,ownedLocalDraftReceipt(receipt,'scope',mine,saved))).toBe(true);
    expect(listLocalDrafts(store,'scope').drafts).toMatchObject([{definition:{id:other.id,name:other.name}}]);
    expect(listLocalDrafts(store,'other-scope').drafts).toMatchObject([{definition:{id:otherScope.id,name:otherScope.name}}]);
  });
  it('keeps a newer replacement written before or during an asynchronous save',()=>{
    const store=browserStore(),saved=examples[0],mine={...saved,name:'Older save'},before={...saved,name:'Newer before save'},during={...saved,name:'Newer during save'};
    const receipt=syncLocalDraft(store,'scope',mine,saved,null);expect(receipt).not.toBeNull();
    saveLocalDraft(store,'scope',before,saved);expect(removeOwnedLocalDraft(store,receipt)).toBe(false);
    expect(listLocalDrafts(store,'scope').drafts[0]?.definition.name).toBe(before.name);
    const laterReceipt=syncLocalDraft(store,'scope',mine,saved,null);saveLocalDraft(store,'scope',during,saved);
    expect(removeOwnedLocalDraft(store,laterReceipt)).toBe(false);
    expect(listLocalDrafts(store,'scope').drafts[0]?.definition.name).toBe(during.name);
  });
  it('keeps a newer receipt through the saved definition clean-up effect',()=>{
    const store=browserStore(),saved=examples[0],older={...saved,name:'Older save'},newer={...saved,name:'Newer edit'};
    const savingReceipt=syncLocalDraft(store,'scope',older,saved,null);expect(savingReceipt).not.toBeNull();
    const newerReceipt=syncLocalDraft(store,'scope',newer,saved,savingReceipt);expect(newerReceipt).not.toBeNull();
    expect(removeOwnedLocalDraft(store,savingReceipt)).toBe(false);
    // Save clears its owned receipt before receive(saved), so the clean effect
    // has no ownership to remove from the newer stored snapshot.
    expect(syncLocalDraft(store,'scope',saved,saved,null)).toBeNull();
    expect(listLocalDrafts(store,'scope').drafts[0]?.definition.name).toBe(newer.name);
  });
  it('does not admit a receipt for a different scope, loop, or local definition',()=>{
    const store=browserStore(),saved=examples[0],mine={...saved,name:'My draft'},changed={...saved,name:'Changed before save'};
    const receipt=syncLocalDraft(store,'scope',mine,saved,null);expect(receipt).not.toBeNull();
    expect(ownedLocalDraftReceipt(receipt,'other-scope',mine,saved)).toBeNull();
    expect(ownedLocalDraftReceipt(receipt,'scope',examples[1],saved)).toBeNull();
    expect(ownedLocalDraftReceipt(receipt,'scope',changed,saved)).toBeNull();
    expect(removeOwnedLocalDraft(store,ownedLocalDraftReceipt(receipt,'scope',changed,saved))).toBe(false);
    expect(listLocalDrafts(store,'scope').drafts[0]?.definition.name).toBe(mine.name);
  });
});
