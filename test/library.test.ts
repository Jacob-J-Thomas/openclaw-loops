import {describe,it,expect} from 'vitest';
import {Engine,type Actor,type State,type Storage} from '../src/engine.js';
import {examples} from '../src/examples.js';

const actor:Actor={agentId:'main',sessionKey:'agent:main:library',sessionId:'library',source:'tool',human:false,check:()=>{}};
function setup(){
  let state:State={version:1,loops:{},runs:{}};let allowed=true;
  const storage:Storage={read:()=>structuredClone(state),write:next=>{state=structuredClone(next);}};
  const host={check:()=>{if(!allowed)throw new Error('Host policy denied');},complete:async()=>({text:'unused'}),modelInfo:async()=>({})};
  const engine=new Engine(storage,host);
  const create=(index:number,enabled=true)=>{const d={...structuredClone(examples[0]),schemaVersion:2 as const,id:`loop-${String(index).padStart(3,'0')}`,slug:`browse-${index}`,name:`Loop ${index}`,revision:0};return engine.save(actor,d,0,enabled).record;};
  return {engine,create,reopen:()=>new Engine(storage,host),deny:()=>{allowed=false;}};
}
describe('paged loop discovery',()=>{
  it('retrieves more than former limits in stable pages without duplicates and preserves legacy arrays',()=>{
    const {engine,create}=setup();for(let i=64;i>=0;i--)create(i,i%2===0);
    const ids:string[]=[];let cursor:string|undefined;
    do{const page=engine.browse(actor,{limit:7,cursor});expect(page.items.length).toBeLessThanOrEqual(7);expect(page.total).toBe(65);ids.push(...page.items.map(item=>item.id));cursor=page.nextCursor??undefined;}while(cursor);
    expect(ids).toHaveLength(65);expect(new Set(ids).size).toBe(65);expect(ids).toEqual([...ids].sort());
    expect(engine.library(actor)).toHaveLength(65);expect(engine.list(actor)).toHaveLength(33);
    expect(engine.browse(actor,{view:'runnable',limit:100}).items).toHaveLength(33);
  });
  it('searches the complete library and keeps draft and publication discovery distinct',()=>{
    const {engine,create}=setup();for(let i=0;i<60;i++)create(i);
    const r=engine.load(actor,'loop-059');engine.draft(actor,{...r.definition,name:'Unpublished name',slug:'unpublished-slug',description:'Needle'},1);
    expect(engine.browse(actor,{search:'NEEDLE'}).items).toEqual([expect.objectContaining({id:r.definition.id,revision:2,hasDraft:true})]);
    expect(engine.browse(actor,{view:'runnable',search:'Needle'}).total).toBe(0);
    expect(engine.browse(actor,{view:'runnable',search:'browse-59'}).items).toEqual([expect.objectContaining({slug:'browse-59',revision:1})]);
  });
  it('pages recoverable records with author authority and preserves requested activation behavior',()=>{
    const {engine,create}=setup();for(let i=0;i<4;i++){const r=create(i);if(i%2)engine.delete(actor,r.definition.id,1);else engine.archive(actor,r.definition.id,1,true);}
    expect(engine.browse(actor).total).toBe(0);const first=engine.browse(actor,{view:'recoverable',limit:2});
    expect(first.total).toBe(4);expect(first.items[1].deletedAt).toBeDefined();expect(engine.browse(actor,{view:'recoverable',limit:2,cursor:first.nextCursor!}).items.map(i=>i.id)).toEqual(['loop-002','loop-003']);
    expect(()=>engine.browse({...actor,source:'session-action',human:false,canManage:false},{view:'recoverable'})).toThrow(/write access/);
    engine.recover(actor,'loop-000',1);expect(engine.browse(actor).items[0].enabledRevision).toBeNull();
  });
  it('rejects changed-library, cross-query and cross-session cursors instead of skipping records',()=>{
    const {engine,create}=setup();for(let i=0;i<5;i++)create(i);const first=engine.browse(actor,{limit:2});
    expect(()=>engine.browse(actor,{cursor:first.nextCursor!,search:'Loop'})).toThrow(/Library changed/);
    expect(()=>engine.browse({...actor,sessionId:'other'},{cursor:first.nextCursor!})).toThrow(/Library changed/);
    expect(()=>engine.browse(actor,{cursor:'not-a-cursor'})).toThrow(/cursor/);
    engine.edit(actor,'loop-004',1,{name:'Changed'});
    expect(()=>engine.browse(actor,{cursor:first.nextCursor!})).toThrow(expect.objectContaining({code:'LOOPS_LIBRARY_CHANGED'}));
    expect(engine.browse(actor,{limit:2}).total).toBe(5);
  });
  it('rechecks host policy and accepts unchanged cursor state after reopen',()=>{
    const {engine,create,reopen,deny}=setup();for(let i=0;i<4;i++)create(i);const first=engine.browse(actor,{view:'runnable',limit:2});
    expect(reopen().browse(actor,{view:'runnable',cursor:first.nextCursor!}).items).toHaveLength(2);
    deny();expect(engine.browse(actor,{view:'runnable'}).items).toEqual([]);
    expect(()=>engine.browse(actor,{view:'runnable',cursor:first.nextCursor!})).toThrow(/Library changed/);
    expect(()=>engine.browse({...actor,check:()=>{throw Error('Caller revoked');}})).toThrow('Caller revoked');
  });
  it.each([{limit:0},{limit:1001},{limit:NaN},{cursor:''},{search:'x'.repeat(501)},{view:'unknown'}])('rejects malformed paging input %j',query=>{
    expect(()=>setup().engine.browse(actor,query as Parameters<Engine['browse']>[1])).toThrow(expect.objectContaining({code:'LOOPS_INVALID_REQUEST'}));
  });
});
