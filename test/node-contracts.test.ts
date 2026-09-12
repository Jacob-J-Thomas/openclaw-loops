import {describe,it,expect,vi} from 'vitest';
import {Engine,type Actor,type State,type HostCapabilities} from '../src/engine.js';
import {examples} from '../src/examples.js';
import {nodeContract,requiredCapabilities} from '../src/node-contracts.js';
import {validateGraph,type Definition} from '../src/graph.js';

// Author through the palette's registry, then execute through the real engine.
// This journey covers all current kinds, body settings, journaling and parking.
describe('shared node contracts',()=>{
  it('executes a registry-authored graph through six iterations, restart, human review and both exits',async()=>{
    let state:State|undefined;
    const storage={read:()=>structuredClone(state),write:(value:State)=>{state=structuredClone(value);}};
    const actor:Actor={agentId:'research',sessionKey:'agent:research:registry',sessionId:'registry-session',source:'tool',human:false,check:()=>{}};
    let sequence=0;const fresh=(prefix:string)=>`${prefix}-${++sequence}`;
    const input=nodeContract('input').editor.create('input',fresh,6);
    const action=nodeContract('action').editor.create('model',fresh,6);
    const condition=nodeContract('condition').editor.create('allowed',fresh,6);
    condition.predicate={left:'{{nodes.model.model}}',op:'equals',right:'fake/selected'};
    const repeat=nodeContract('repeat').editor.create('refine',fresh,6);
    repeat.body[0].prompt='Attempt {{repeat.index}}: {{input.text}}';repeat.body[0].advanced={temperature:0,maxTokens:800};
    repeat.body[1].predicate={left:'{{repeat.index}}',op:'greater-than',right:'{{input.threshold}}'};
    const wait=nodeContract('wait').editor.create('wait',fresh,6);wait.message='{{nodes.refine.text}}';
    const review=nodeContract('review').editor.create('review',fresh,6);review.proposal='{{nodes.refine.text}}';
    const returned=nodeContract('return').editor.create('return',fresh,6);returned.value='{{nodes.refine.text}}';
    const failed=nodeContract('fail').editor.create('fail',fresh,6);failed.reason='Required evidence was rejected.';
    const nodes=[input,action,condition,repeat,wait,review,returned,failed];
    const edges:Definition['edges']=[['input','model','next'],['model','allowed','next'],['allowed','refine','true'],['allowed','fail','false'],['refine','wait','next'],['wait','review','next'],['review','return','approve'],['review','fail','reject']].map(([source,target,port],i)=>({id:`edge-${i}`,source,target,port:port as Definition['edges'][number]['port']}));
    const definition:Definition={...structuredClone(examples[0]),schemaVersion:2,nodes,edges,capabilities:requiredCapabilities(nodes),inputSchema:[{name:'text',label:'Request',type:'text',required:true},{name:'threshold',label:'Threshold',type:'number',required:true}],limits:{maxExecutions:1000,maxOutputBytes:100000}};
    expect(validateGraph(definition)).toEqual([]);
    const host={check:vi.fn(),modelInfo:vi.fn(async()=>({model:'fake/selected',provider:'fake',agentId:'research'})),complete:vi.fn<HostCapabilities['complete']>(async(_actor,prompt)=>({text:prompt}))};
    const first=new Engine(storage,host);const waiting=await first.test(actor,definition,{text:'Evidence',threshold:5},'all-kinds');
    expect(waiting).toMatchObject({state:'waiting',pending:'Attempt 6: Evidence',outputs:{refine:{succeeded:true,iterations:6,exhausted:false}}});
    expect(host.complete).toHaveBeenCalledTimes(6);
    for(const call of host.complete.mock.calls)expect(call[4]?.advanced).toEqual({temperature:0,maxTokens:800});
    expect(waiting.trace.filter(step=>step.kind==='inference').map(step=>step.iteration)).toEqual([1,2,3,4,5,6]);
    await first.close();const second=new Engine(storage,host);
    try{
      const parked=await second.resume(actor,waiting.id);expect(parked).toMatchObject({state:'review',pending:'Attempt 6: Evidence'});
      await expect(second.review(actor,waiting.id,'approve')).rejects.toThrow(/human/);
      const human:Actor={...actor,source:'session-action',human:true};
      const completed=await second.review(human,waiting.id,'approve');expect(completed).toMatchObject({state:'completed',result:'Attempt 6: Evidence'});
      expect(host.complete).toHaveBeenCalledTimes(6);
      const rejected=await second.test(actor,definition,{text:'Reject',threshold:0},'rejected-review');
      await second.resume(actor,rejected.id);
      expect(await second.review(human,rejected.id,'reject')).toMatchObject({state:'failed',errorDetail:{code:'LOOPS_EXPLICIT_FAILURE',message:'Required evidence was rejected.'}});
    }finally{await second.close();}
  });
});
