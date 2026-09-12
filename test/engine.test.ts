import {describe,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine,FileStorage,type Actor,type HostCapabilities,type Storage} from '../src/engine.js';
import {examples} from '../src/examples.js';
import {bind,parseDefinition,validateGraph,validateInput,type Definition} from '../src/graph.js';

// These deterministic capability fakes test graph mechanics, never live model acceptance.
class Memory implements Storage{state:ReturnType<Storage['read']>;read(){return structuredClone(this.state);}write(state:Parameters<Storage['write']>[0]){this.state=structuredClone(state);}}
const human=():Actor=>({agentId:'main',sessionKey:'agent:main:test',sessionId:'session-1',source:'session-action',requester:'operator-test',human:true,check:()=>{}});
const agent=():Actor=>({...human(),source:'tool',human:false});
function content(slug='agent-draft'){
  const {id:_id,revision:_revision,schemaVersion:_version,...value}=structuredClone(examples[0]);
  return {...value,slug};
}
function setup(text='A safe draft with KEY'){
  const storage=new Memory();const host:HostCapabilities={check:vi.fn(),complete:vi.fn(async()=>({text,provider:'fake',model:'deterministic-test-only',agentId:'main'})),modelInfo:vi.fn(async()=>({provider:'fake',model:'deterministic-test-only',agentId:'main'}))};
  const e=new Engine(storage,host);const h=human();for(const ex of examples)e.enable(h,ex.id,1,true,ex.capabilities);return {e,host,storage,h};
}
describe('graph contracts',()=>{
  it('accepts all shipped examples',()=>{for(const d of examples){expect(parseDefinition(d)).toEqual(d);expect(validateGraph(d)).toEqual([]);}});
  it('rejects unsafe imported shape and arbitrary code nodes',()=>{expect(()=>parseDefinition({...examples[0],enabled:true})).toThrow();expect(()=>parseDefinition({...examples[0],nodes:[{id:'shell',kind:'shell',command:'echo nope'}]})).toThrow();});
  it('rejects cycles, missing branches and missing capabilities',()=>{const d=structuredClone(examples[0]);d.edges[1].target='input';d.capabilities=[];expect(validateGraph(d).map(i=>i.message).join(' ')).toMatch(/cycles/);expect(validateGraph(d).some(i=>i.message.includes('llm'))).toBe(true);d.edges=[];expect(validateGraph(d).some(i=>i.nodeId==='input')).toBe(true);});
  it('rejects future and forged bindings',()=>{const d=structuredClone(examples[0]);const n=d.nodes[1];if(n.kind!=='inference')throw Error();n.prompt='{{nodes.return.text}} {{input.missing}} {{input.__proto__.x}}';expect(validateGraph(d).length).toBeGreaterThan(2);expect(()=>bind('{{input.constructor}}',{input:{},nodes:{}})).toThrow();});
  it('requires branch outputs to dominate their consumers',()=>{const d=structuredClone(examples[1]);const n=d.nodes.at(-1)!;if(n.kind!=='fail')throw Error();n.reason='{{nodes.return.value}}';expect(validateGraph(d).some(i=>i.nodeId==='fail')).toBe(true);});
  it('preserves typed binding values without evaluation',()=>{expect(bind('{{input.count}}',{input:{count:3},nodes:{}})).toBe(3);expect(bind('Value: {{input.count}}',{input:{count:3},nodes:{}})).toBe('Value: 3');expect(()=>bind('{{nodes.absent.text}}',{input:{},nodes:{}})).toThrow();});
  it('rejects unexpected, wrong-type, and oversized input',()=>{for(const input of [{text:3},{text:'ok',requester:'forged'},{}, {text:'a'.repeat(17000)}])expect(()=>validateInput(examples[0],input)).toThrow();});
});
describe('agent definition authoring',()=>{
  it('reads disabled drafts fully without granting execution or exposing a mutable store reference',()=>{
    const {e,h}=setup();e.enable(h,'summarize-text',1,false,[]);
    expect(e.library(agent())).toContainEqual(expect.objectContaining({id:'summarize-text',enabledRevision:null}));
    const loaded=e.load(agent(),'summarize-text');loaded.definition.nodes=[];
    expect(e.load(agent(),'summarize-text').definition.nodes).toHaveLength(3);
    expect(()=>e.describe(agent(),'summarize-text')).toThrow(/Enabled/);
  });
  it('creates, edits and persists disabled drafts with server-owned identity and revision',()=>{
    const {e,host,storage}=setup();const created=e.create(agent(),content(),false);const id=created.record.definition.id;
    expect(created.record).toMatchObject({enabledRevision:null,grants:[],definition:{revision:1,slug:'agent-draft'}});
    expect(created.issues).toEqual([]);expect(id).toMatch(/^loop-/);
    const nodes=structuredClone(created.record.definition.nodes);if(nodes[1].kind!=='inference')throw Error();nodes[1].prompt='Rewrite: {{input.text}}';
    const edited=e.edit(agent(),id,1,{name:'Agent edited',nodes});
    expect(edited.record).toMatchObject({enabledRevision:null,grants:[],definition:{id,revision:2,name:'Agent edited',nodes}});
    expect(new Engine(storage,host).load(agent(),id)).toEqual(edited.record);
    expect(e.list(agent()).some(d=>d.id===id)).toBe(false);
    expect(host.complete).not.toHaveBeenCalled();
  });
  it('rejects duplicate creation, stale edits and stale deletion without changing the saved draft',()=>{
    const {e,h}=setup();const {record}=e.create(agent(),content(),false);const id=record.definition.id;
    expect(()=>e.create(agent(),content(),false)).toThrow(/slug/);
    const latest=e.save(h,{...record.definition,name:'Human edit'},1);
    expect(()=>e.edit(agent(),id,1,{name:'Stale agent edit'})).toThrow(/conflict/);
    expect(()=>e.delete(agent(),id,1)).toThrow(/conflict/);
    expect(e.load(agent(),id)).toEqual(latest.record);
  });
  it('rejects unsafe or privileged fields and keeps runtime fields server-owned and human review explicit',async()=>{
    const {e}=setup();
    for(const forbidden of [{grants:['llm']},{enabledRevision:1},{id:'replacement'},{revision:9},{schemaVersion:2}]){
      expect(()=>e.create(agent(),{...content(),...forbidden})).toThrow();
      expect(()=>e.edit(agent(),'summarize-text',1,forbidden)).toThrow();
    }
    expect(()=>e.edit(agent(),'summarize-text',1,{})).toThrow();
    expect(()=>e.create(agent(),{...content(),nodes:[{id:'exec',kind:'shell'}]})).toThrow();
    await expect(e.review(agent(),'any','approve')).rejects.toThrow(/human/);
    for(const actor of [{...human(),human:false},{...agent(),source:'command' as const}])expect(()=>e.create(actor,content())).toThrow(/authorized/);
  });
  it('saves graph validation issues as a disabled draft and prevents enabling it',()=>{
    const {e,h}=setup();const edited=e.edit(agent(),'summarize-text',1,{edges:[]},false);
    expect(edited.issues.length).toBeGreaterThan(0);expect(edited.record.enabledRevision).toBeNull();
    expect(()=>e.enable(h,'summarize-text',2,true,['llm'])).toThrow(/edge/);
  });
  it('pins existing runs across agent edits and refuses deletion until runs finish',async()=>{
    const {e}=setup();const run=await e.run(agent(),'read-pause-continue',{text:'Original request'},'agent-edit-pin');
    expect(()=>e.delete(agent(),'read-pause-continue',1)).toThrow(/active or parked/);
    e.edit(agent(),'read-pause-continue',1,{name:'Edited draft'},false);
    expect(e.load(agent(),'read-pause-continue').enabledRevision).toBeNull();
    const completed=await e.resume(agent(),run.id);
    expect(completed).toMatchObject({state:'completed',definition:{revision:1,name:'Read, pause, continue'}});
    expect(e.delete(agent(),'read-pause-continue',2)).toMatchObject({deleted:true,revision:2});
    expect(e.status(agent(),run.id)).toEqual(completed);
  });
  it('refuses deletion during review or while a cancelled host call is settling',async()=>{
    const {e,host}=setup();const review=await e.run(agent(),'draft-refinement',{text:'A',phrase:'KEY'},'pending-review');
    expect(()=>e.delete(agent(),'draft-refinement',1)).toThrow(/parked/);e.cancel(agent(),review.id);
    expect(e.delete(agent(),'draft-refinement',1).deleted).toBe(true);
    let settle:(value:{text:string})=>void=()=>{};vi.mocked(host.complete).mockImplementation(()=>new Promise(resolve=>{settle=resolve;}));const pending=e.run(agent(),'summarize-text',{text:'A'},'cancel-delete');
    await Promise.resolve();e.cancel(agent(),e.runs(agent()).find(r=>r.slug==='summarize-text')!.id);
    expect(()=>e.delete(agent(),'summarize-text',1)).toThrow(/active/);
    await pending;expect(()=>e.delete(agent(),'summarize-text',1)).toThrow(/active/);settle({text:'late'});await Promise.resolve();expect(e.delete(agent(),'summarize-text',1).deleted).toBe(true);
  });
  it('retains historical runs across deletion and restart, with new identity on slug reuse',async()=>{
    const {e,host,storage}=setup();const run=await e.run(agent(),'summarize-text',{text:'A'},'history');
    e.delete(agent(),'summarize-text',1);const restarted=new Engine(storage,host);
    expect(()=>restarted.load(agent(),'summarize-text')).toThrow(/not found/);
    expect(restarted.status(agent(),run.id)).toEqual(run);
    const recreated=restarted.create(agent(),content('summarize-text')).record;
    expect(recreated.definition.id).not.toBe('summarize-text');
    expect(()=>restarted.edit(agent(),'summarize-text',1,{name:'Stale'})).toThrow(/not found/);
  });
  it('supports libraries beyond the old POC cap and allows deleted slugs to be reused',()=>{
    const {e}=setup();for(let i=0;i<80;i++)e.create(agent(),content(`draft-${i}`));
    expect(e.create(agent(),content('over-capacity')).record.definition.revision).toBe(1);expect(e.library(agent()).length).toBe(84);
    e.delete(agent(),'summarize-text',1);expect(e.create(agent(),content('reclaimed')).record.definition.revision).toBe(1);
  });
  it('rechecks host authorization for reads and every mutation',()=>{
    const {e}=setup();const revoked={...agent(),check:()=>{throw Error('Authority revoked');}};
    for(const call of [()=>e.library(revoked),()=>e.load(revoked,'summarize-text'),()=>e.create(revoked,content()),()=>e.edit(revoked,'summarize-text',1,{name:'X'}),()=>e.delete(revoked,'summarize-text',1),()=>e.enable(revoked,'summarize-text',1,true),()=>e.revoke(revoked,'summarize-text')])expect(call).toThrow(/revoked/);
    expect(e.library(agent())).toHaveLength(3);
  });
});
describe('agent activation and publishing',()=>{
  it('creates enabled by default and executes the actual saved revision',async()=>{
    const {e,host,storage}=setup('Published result');const {record}=e.create(agent(),content('enabled-on-create'));
    expect(record).toMatchObject({enabledRevision:1,grants:['llm'],definition:{revision:1}});
    expect(e.list(agent())).toContainEqual(expect.objectContaining({id:record.definition.id,revision:1}));
    expect((await e.run(agent(),'enabled-on-create',{text:'Source'},'created-enabled'))).toMatchObject({state:'completed',result:'Published result',definition:{revision:1}});
    expect(new Engine(storage,host).load(agent(),record.definition.id)).toEqual(record);
  });
  it('lets agents enable, disable, re-enable and revoke an explicit draft',async()=>{
    const {e}=setup();const {record}=e.create(agent(),content('activation-control'),false);const id=record.definition.id;
    expect(record).toMatchObject({enabledRevision:null,grants:[]});
    expect(e.enable(agent(),id,1,true)).toMatchObject({enabledRevision:1,grants:['llm']});
    e.enable(agent(),id,1,false);await expect(e.run(agent(),'activation-control',{text:'A'},'disabled')).rejects.toThrow(/Enabled/);
    e.enable(agent(),id,1,true);expect((await e.run(agent(),'activation-control',{text:'A'},'enabled')).state).toBe('completed');
    expect(e.revoke(agent(),id)).toMatchObject({enabledRevision:null,grants:[]});
  });
  it('preserves activation across edits and honors explicit draft and publish choices',()=>{
    const {e}=setup();const id=e.create(agent(),content()).record.definition.id;
    expect(e.edit(agent(),id,1,{name:'Still enabled'}).record.enabledRevision).toBe(2);
    expect(e.edit(agent(),id,2,{name:'Draft'},false).record.enabledRevision).toBeNull();
    expect(e.edit(agent(),id,3,{name:'Still a draft'}).record.enabledRevision).toBeNull();
    expect(e.edit(agent(),id,4,{name:'Published'},true).record.enabledRevision).toBe(5);
    expect(()=>e.enable(agent(),id,4,false)).toThrow(/Revision changed/);
    expect(e.load(agent(),id).enabledRevision).toBe(5);
  });
  it('rejects invalid enabled create or edit atomically and allows saving the same content as a draft',()=>{
    const {e}=setup();const previous=e.load(agent(),'summarize-text');
    expect(()=>e.create(agent(),{...content('invalid-enabled'),edges:[]})).toThrow(/Cannot enable/);
    expect(e.library(agent())).toHaveLength(3);
    expect(()=>e.edit(agent(),'summarize-text',1,{edges:[]})).toThrow(/Cannot enable/);
    expect(e.load(agent(),'summarize-text')).toEqual(previous);
    const draft=e.edit(agent(),'summarize-text',1,{edges:[]},false);expect(draft.record.enabledRevision).toBeNull();expect(draft.issues.length).toBeGreaterThan(0);
    expect(()=>e.enable(agent(),'summarize-text',2,true)).toThrow(/Cannot enable/);
  });
  it('checks host capabilities before committing enabled definitions or grants',()=>{
    const {e,host}=setup();const previous=e.load(agent(),'summarize-text');
    vi.mocked(host.check).mockImplementation(()=>{throw Error('Host capability denied');});
    expect(()=>e.create(agent(),content())).toThrow(/Host capability denied/);
    expect(()=>e.edit(agent(),'summarize-text',1,{name:'Denied'})).toThrow(/Host capability denied/);
    expect(e.load(agent(),'summarize-text')).toEqual(previous);expect(e.library(agent())).toHaveLength(3);
    const draft=e.create(agent(),content(),false).record;expect(()=>e.enable(agent(),draft.definition.id,1,true)).toThrow(/Host capability denied/);
    expect(e.load(agent(),draft.definition.id)).toEqual(draft);
  });
  it('publishes edits without mutating parked runs and distinguishes disable from revoke',async()=>{
    const {e}=setup();const parked=await e.run(agent(),'read-pause-continue',{text:'A'},'pinned');
    expect(e.edit(agent(),'read-pause-continue',1,{name:'Published revision'}).record.enabledRevision).toBe(2);
    e.enable(agent(),'read-pause-continue',2,false);
    expect((await e.resume(agent(),parked.id))).toMatchObject({state:'completed',definition:{revision:1,name:'Read, pause, continue'}});
    e.enable(agent(),'read-pause-continue',2,true);const revoked=await e.run(agent(),'read-pause-continue',{text:'B'},'revoked');
    e.revoke(agent(),'read-pause-continue');await expect(e.resume(agent(),revoked.id)).rejects.toThrow(/revoked/);
  });
  it('supports atomic Save and enable from an operator with write access',()=>{
    const {e}=setup();const operator={...human(),human:false,canManage:true};
    const d={...structuredClone(examples[0]),id:'ui-publish',slug:'ui-publish'};
    expect(e.save(operator,d,0,true).record).toMatchObject({enabledRevision:1,grants:['llm']});
    const previous=e.load(operator,d.id);
    expect(()=>e.save(operator,{...previous.definition,edges:[]},1,true)).toThrow(/Cannot enable/);
    expect(e.load(operator,d.id)).toEqual(previous);
  });
});
describe('shared deterministic execution',()=>{
  it('returns the real adapter result with node timestamps',async()=>{const {e,host}=setup('Summary');const r=await e.run(agent(),'summarize-text',{text:'Source'},'request-1');expect(r.state).toBe('completed');expect(r.result).toBe('Summary');expect(r.trace.map(t=>t.state)).toEqual(['completed','completed','completed']);expect(r.trace.every(t=>t.startedAt&&t.endedAt)).toBe(true);expect(host.complete).toHaveBeenCalledOnce();});
  it('deduplicates admissions and detects request ID conflicts',async()=>{const {e,host}=setup();const a=agent();const first=await e.run(a,'summarize-text',{text:'A'},'repeat');const next=await e.run(a,'summarize-text',{text:'A'},'repeat');expect(first.id).toBe(next.id);expect(host.complete).toHaveBeenCalledOnce();await expect(e.run(a,'summarize-text',{text:'B'},'repeat')).rejects.toThrow(/conflict/);});
  it('starts imports disabled and detects save conflicts',()=>{const {e,h}=setup();const d={...structuredClone(examples[0]),id:'imported',slug:'imported'};const saved=e.save(h,d,0);expect(saved.record.enabledRevision).toBeNull();expect(()=>e.save(h,d,0)).toThrow(/conflict/);expect(e.list(agent()).some(x=>x.id==='imported')).toBe(false);});
  it('pins in-flight revisions across edits and disables new starts',async()=>{const {e,h}=setup();const r=await e.run(agent(),'read-pause-continue',{text:'What model?'},'one');const d=e.load(h,'read-pause-continue').definition;d.name='New name';e.save(h,d,1);expect(e.status(agent(),r.id).definition.revision).toBe(1);expect(e.status(agent(),r.id).definition.name).toBe('Read, pause, continue');await expect(e.run(agent(),'read-pause-continue',{text:'New'},'two')).rejects.toThrow(/Enabled/);expect((await e.resume(agent(),r.id)).state).toBe('completed');});
  it('repeats sequentially and stops on early success',async()=>{const {e,host}=setup();vi.mocked(host.complete).mockResolvedValueOnce({text:'No phrase'}).mockResolvedValueOnce({text:'Contains KEY'});const r=await e.run(agent(),'draft-refinement',{text:'Brief',phrase:'KEY'},'refine');expect(r.state).toBe('review');expect(r.outputs.refine).toMatchObject({iterations:2,succeeded:true,exhausted:false});expect(host.complete).toHaveBeenCalledTimes(2);expect(r.trace.filter(t=>t.iteration).map(t=>t.iteration)).toEqual([1,1,2,2]);});
  it('reports repeat budget exhaustion without claiming success',async()=>{const {e,host}=setup('Does not match');const r=await e.run(agent(),'draft-refinement',{text:'Brief',phrase:'KEY'},'budget');expect(r.state).toBe('review');expect(r.outputs.refine).toMatchObject({iterations:3,succeeded:false,exhausted:true});expect(host.complete).toHaveBeenCalledTimes(3);});
  it('rejects generic resume and agent approval at review; human rejection fails',async()=>{const {e,h}=setup();const r=await e.run(agent(),'draft-refinement',{text:'Brief',phrase:'KEY'},'review');await expect(e.resume(agent(),r.id)).rejects.toThrow(/Approve/);await expect(e.review(agent(),r.id,'approve')).rejects.toThrow(/human/);const rejected=await e.review(h,r.id,'reject');expect(rejected.state).toBe('failed');expect(rejected.review?.decision).toBe('reject');expect(rejected.trace.some(t=>t.nodeId==='return')).toBe(false);});
  it('human approval returns the exact stored draft',async()=>{const {e,h}=setup('Exact KEY draft');const r=await e.run(agent(),'draft-refinement',{text:'Brief',phrase:'KEY'},'approve');const result=await e.review(h,r.id,'approve');expect(result.result).toBe('Exact KEY draft');expect(result.review?.requester).toBe('operator-test');});
  it('branches deterministically',async()=>{const {e,h}=setup();const d:Definition={...structuredClone(examples[0]),id:'branch',slug:'branch',capabilities:[],nodes:[{id:'input',kind:'input',label:'Input'},{id:'check',kind:'condition',label:'Check',predicate:{left:'{{input.text}}',op:'equals',right:'yes'}},{id:'return',kind:'return',label:'Yes',value:'Yes'},{id:'fail',kind:'fail',label:'No',reason:'No'}],edges:[{id:'e1',source:'input',target:'check',port:'next'},{id:'e2',source:'check',target:'return',port:'true'},{id:'e3',source:'check',target:'fail',port:'false'}]};e.save(h,d,0);e.enable(h,d.id,1,true,[]);expect((await e.run(agent(),'branch',{text:'yes'},'true')).result).toBe('Yes');expect((await e.run(agent(),'branch',{text:'no'},'false')).state).toBe('failed');});
  it('records adapter failure without replaying an action',async()=>{const {e,host}=setup();vi.mocked(host.complete).mockRejectedValue(new Error('Provider unavailable'));const r=await e.run(agent(),'summarize-text',{text:'A'},'fail');expect(r.state).toBe('failed');expect(r.errorDetail).toMatchObject({code:'HOST_UNAVAILABLE',retryable:true,nodeId:'summary'});expect(r.trace.at(-1)?.error).toBe(r.errorDetail?.message);expect((await e.run(agent(),'summarize-text',{text:'A'},'fail')).id).toBe(r.id);expect(host.complete).toHaveBeenCalledOnce();});
  it('enforces the global dispatch and output budgets',async()=>{const {e,h}=setup('a'.repeat(9000));const r=await e.run(agent(),'summarize-text',{text:'A'},'large');expect(r.error).toMatch(/Output-size/);const d=e.load(h,'draft-refinement').definition;d.limits.maxExecutions=2;e.save(h,d,1);e.enable(h,d.id,2,true,d.capabilities);const limited=await e.run(agent(),d.slug,{text:'A',phrase:'KEY'},'limited');expect(limited.error).toMatch(/budget/);expect(limited.executions).toBe(2);});
  it('cancels in flight and dispatches nothing else',async()=>{const {e,host}=setup();let release:(value:{text:string})=>void=()=>{};vi.mocked(host.complete).mockImplementation(()=>new Promise(resolve=>{release=resolve;}));const pending=e.run(agent(),'summarize-text',{text:'A'},'cancel');await Promise.resolve();const id=e.runs(agent())[0].id;expect(e.cancel(agent(),id).state).toBe('cancelled');release({text:'late'});const r=await pending;expect(r.state).toBe('cancelled');expect(r.trace.some(t=>t.nodeId==='return')).toBe(false);expect(r.uncertainty).toMatch(/may have completed/);});
  it('returns a truthful running handle for slow work and keeps one service-owned execution',async()=>{vi.useFakeTimers();try{const {e,host}=setup();let release:(value:{text:string})=>void=()=>{};vi.mocked(host.complete).mockImplementation(()=>new Promise(resolve=>{release=resolve;}));const admitted=e.run(agent(),'summarize-text',{text:'A'},'slow');await vi.advanceTimersByTimeAsync(10001);const handle=await admitted;expect(handle.state).toBe('running');expect((await e.run(agent(),'summarize-text',{text:'A'},'slow')).id).toBe(handle.id);release({text:'Finished later'});await vi.advanceTimersByTimeAsync(1);expect(e.status(agent(),handle.id)).toMatchObject({state:'completed',result:'Finished later'});expect(host.complete).toHaveBeenCalledOnce();await e.close();}finally{vi.useRealTimers();}});
  it('enforces timeout even if an adapter ignores cancellation',async()=>{vi.useFakeTimers();try{const {e,host,h}=setup();const d=e.load(h,'summarize-text').definition;d.limits.timeoutMs=1000;e.save(h,d,1);e.enable(h,d.id,2,true,d.capabilities);vi.mocked(host.complete).mockImplementation(()=>new Promise(()=>{}));const pending=e.run(agent(),d.slug,{text:'A'},'timeout');await vi.advanceTimersByTimeAsync(1001);expect((await pending).error).toMatch(/timeout/);}finally{vi.useRealTimers();}});
});
describe('authority and durability',()=>{
  it('queues starts, Continue and human decisions and keeps the physical slot until cleanup',async()=>{
    const {e,h,host}=setup();
    const wait=await e.run(agent(),'read-pause-continue',{text:'A'},'park');
    const review=await e.run(agent(),'draft-refinement',{text:'A',phrase:'KEY'},'review-queue');
    let settle:(value:{text:string})=>void=()=>{};
    vi.mocked(host.complete).mockClear().mockImplementation(()=>new Promise(resolve=>{settle=resolve;}));
    const first=e.run(agent(),'summarize-text',{text:'A'},'busy-1');
    const second=await e.run(agent(),'summarize-text',{text:'A'},'busy-2');
    expect(second.state).toBe('queued');
    expect((await e.resume(agent(),wait.id)).state).toBe('queued');
    expect((await e.review(h,review.id,'approve')).state).toBe('queued');
    const firstId=e.runs(agent()).find(r=>r.state==='running')!.id;
    e.cancel(agent(),firstId);await first;
    expect(e.status(agent(),firstId).cleanupPending).toBe(true);
    expect(e.status(agent(),second.id).state).toBe('queued');expect(host.complete).toHaveBeenCalledOnce();
    for(const run of e.runs(agent()).filter(r=>r.state==='queued'))e.cancel(agent(),run.id);
    settle({text:'Late result'});await Promise.resolve();await Promise.resolve();
    expect(e.status(agent(),firstId).cleanupPending).toBe(false);expect(host.complete).toHaveBeenCalledOnce();
  });
  it('bounds checkpoint proposals and clears rejected oversized results',async()=>{
    const {e,h}=setup();const d=e.load(h,'read-pause-continue').definition;
    const wait=d.nodes.find(n=>n.kind==='wait')!;if(wait.kind!=='wait')throw Error();
    wait.message='{{input.text}}';d.limits.maxOutputBytes=128;e.save(h,d,1);e.enable(h,d.id,2,true,d.capabilities);
    const run=await e.run(agent(),d.slug,{text:'界'.repeat(100)},'large-checkpoint');
    expect(run.state).toBe('failed');expect(run.error).toMatch(/Output-size/);expect(run.pending).toBeUndefined();
    expect(()=>validateInput(examples[0],{text:'界'.repeat(6000)})).toThrow(/16 KB/);
  });
  it('validates model JSON before allowing downstream execution',async()=>{
    const {e,h,host}=setup();const d=e.load(h,'summarize-text').definition;
    const n=d.nodes[1];if(n.kind!=='inference')throw Error();n.output='json';e.save(h,d,1);e.enable(h,d.id,2,true,d.capabilities);
    vi.mocked(host.complete).mockResolvedValueOnce({text:'{"nested":{"unbounded":true}}'}).mockResolvedValueOnce({text:'{"ok":true,"count":3}'});
    const failed=await e.run(agent(),d.slug,{text:'A'},'bad-json');expect(failed.state).toBe('failed');expect(failed.trace.some(t=>t.nodeId==='return')).toBe(false);
    const valid=await e.run(agent(),d.slug,{text:'A'},'good-json');expect(valid.outputs.summary).toMatchObject({value:{ok:true,count:3}});
  });
  it('blocks disabled loops, forged ownership, and read-only operator writes',async()=>{const {e,h}=setup();e.enable(h,'summarize-text',1,false,[]);await expect(e.run(agent(),'summarize-text',{text:'A'},'disabled')).rejects.toThrow();expect(()=>e.save({...h,human:false},examples[0],0)).toThrow(/authorized/);const r=await e.run(agent(),'read-pause-continue',{text:'A'},'owner');expect(()=>e.status({...agent(),sessionId:'forged'},r.id)).toThrow(/not found/);expect(()=>e.cancel({...h,sessionKey:'guessed'},r.id)).toThrow(/not found/);});
  it('checks revoked capability before resume',async()=>{const {e,h,host}=setup();const r=await e.run(agent(),'read-pause-continue',{text:'A'},'revoke');e.revoke(h,'read-pause-continue');await expect(e.resume(agent(),r.id)).rejects.toThrow(/revoked/);expect(host.complete).not.toHaveBeenCalled();expect(e.status(agent(),r.id).state).toBe('waiting');});
  it('checks host authority at every action after admission',async()=>{const {e,host}=setup();vi.mocked(host.check).mockImplementation((_a,c)=>{if(c==='model-info'&&vi.mocked(host.check).mock.calls.length>5)throw Error('Host permission revoked');});const r=await e.run(agent(),'read-pause-continue',{text:'A'},'deny');expect(r.state).toBe('failed');expect(host.modelInfo).not.toHaveBeenCalled();});
  it('persists a parked run and resumes once with pinned revision after restart',async()=>{const directory=mkdtempSync(join(tmpdir(),'loops-test-'));try{const {host,h}=setup();const storage=new FileStorage(join(directory,'state.json'));const first=new Engine(storage,host);first.enable(h,'read-pause-continue',1,true,['model-info','llm']);const parked=await first.run(agent(),'read-pause-continue',{text:'A'},'restart');await first.close();const restarted=new Engine(storage,host);expect(restarted.status(agent(),parked.id).state).toBe('waiting');const done=await restarted.resume(agent(),parked.id);expect(done.state).toBe('completed');expect(done.definition.revision).toBe(1);expect(host.modelInfo).toHaveBeenCalledOnce();await expect(restarted.resume(agent(),parked.id)).rejects.toThrow();}finally{rmSync(directory,{recursive:true,force:true});}});
  it('marks unknown in-flight outcomes interrupted on restart',()=>{const {e,storage,host}=setup();const state=storage.read()!;state.runs.unknown={id:'unknown',requestKey:'x',requestFingerprint:'x',owner:{agentId:'main',sessionKey:human().sessionKey,sessionId:'session-1'},source:'tool',definition:examples[0],input:{text:'A'},state:'running',cursor:'summary',outputs:{},trace:[],executions:1,activeMs:0,createdAt:'2026-09-09',updatedAt:'2026-09-09'};storage.write(state);const restarted=new Engine(storage,host);expect(restarted.status(agent(),'unknown').state).toBe('interrupted');expect(restarted.status(agent(),'unknown').uncertainty).toMatch(/unknown/);expect(e.list(agent()).length).toBe(3);});
});
