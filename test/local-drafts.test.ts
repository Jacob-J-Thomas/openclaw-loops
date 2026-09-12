import {describe,it,expect} from 'vitest';
import {saveLocalDraft,listLocalDrafts,removeLocalDraft} from '../src/local-drafts.js';
import {examples} from '../src/examples.js';
function browserStore(){const values=new Map<string,string>();return {get length(){return values.size;},key:(i:number)=>[...values.keys()][i]??null,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};}
describe('recoverable browser drafts',()=>{
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
});
