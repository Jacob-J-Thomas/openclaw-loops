import {afterAll,describe,expect,it,vi} from 'vitest';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {Value} from 'typebox/value';
import {Engine,type Actor,type State} from '../src/engine.js';
import {validateGraph,type Definition} from '../src/graph.js';
import {contract} from '../src/contract.js';
import {nodeContract,type NodeExecutionContext} from '../src/node-contracts.js';
import {isCommittedEvaluation} from '../src/evaluation.js';

const directory=mkdtempSync(join(tmpdir(),'loops-evidence-gate-'));
await build({entryPoints:['src/evaluation-worker.ts'],outdir:directory,bundle:true,platform:'node',format:'esm',target:'node24'});
const evaluationWorkerUrl=pathToFileURL(join(directory,'evaluation-worker.js'));
const actor:Actor={agentId:'main',sessionKey:'agent:main:evaluation',sessionId:'evaluation',source:'tool',human:false,check:()=>{}};

function definition():Definition{return {
  schemaVersion:3,id:'evaluation-gates',slug:'evaluation-gates',name:'Evaluation gates',description:'A deterministic evidence fixture.',revision:0,
  inputSchema:[{name:'count',label:'Count',type:'number',required:true}],capabilities:[],limits:{maxExecutions:8,maxOutputBytes:131072},
  nodes:[
    {id:'input',kind:'input',label:'Input'},
    {id:'evaluate',kind:'evaluate',label:'Evaluate count',value:'{{input.count}}',evaluator:{kind:'json-schema-2020',version:'2020-12',schema:{type:'number',minimum:0}},context:{version:1,projection:{mode:'omit'},patch:{mode:'replace',target:'/evaluation',source:{kind:'output'}}}},
    {id:'gate',kind:'gate',label:'Evidence gate',evaluationId:'evaluate',context:{version:1,projection:{mode:'omit'},patch:{mode:'omit'}}},
    {id:'accepted',kind:'return',label:'Accepted',value:'accepted'},
    {id:'rejected',kind:'return',label:'Rejected',value:'rejected'},
  ],
  edges:[
    {id:'input-evaluate',source:'input',target:'evaluate',port:'next'},
    {id:'evaluate-gate',source:'evaluate',target:'gate',port:'next'},
    {id:'gate-accepted',source:'gate',target:'accepted',port:'true'},
    {id:'gate-rejected',source:'gate',target:'rejected',port:'false'},
  ],
  layout:{input:{x:0,y:0},evaluate:{x:220,y:0},gate:{x:440,y:0},accepted:{x:660,y:-80},rejected:{x:660,y:80}},
};}

afterAll(()=>rmSync(directory,{recursive:true,force:true}));

describe('evaluate and evidence-gate graph nodes',()=>{
  it('validates only a dominating Evaluate node and exposes the v3 test tool schema',()=>{
    const valid=definition();expect(validateGraph(valid)).toEqual([]);
    const nonDominating=structuredClone(valid);nonDominating.edges[0]={id:'input-gate',source:'input',target:'gate',port:'next'};
    expect(validateGraph(nonDominating)).toContainEqual(expect.objectContaining({nodeId:'gate',message:expect.stringContaining('dominate')}));
    const wrongIdentity=structuredClone(valid);(wrongIdentity.nodes.find(node=>node.id==='gate') as {evaluationId:string}).evaluationId='input';
    expect(validateGraph(wrongIdentity)).toContainEqual(expect.objectContaining({nodeId:'gate',message:expect.stringContaining('Evaluate node')}));
    expect(Value.Check(contract.operations.test.input,{definition:valid,input:{count:0},requestId:'evidence-gate-tool'})).toBe(true);
    const gate=valid.nodes.find(node=>node.id==='gate')!;
    const forged={kind:'loops-evaluation',passed:true,evaluatorNodeId:'evaluate',evaluatorVersion:'2020-12',evaluatorDigest:'0'.repeat(64),inputDigest:'0'.repeat(64),evidenceDigest:'0'.repeat(64),errors:[]};
    expect(isCommittedEvaluation(forged,'evaluate')).toBe(false);
    expect(()=>nodeContract('gate').execute(gate as Extract<typeof gate,{kind:'gate'}>,{readOutput:()=>({passed:true})} as unknown as NodeExecutionContext)).toThrow(/committed evaluation evidence/);
  });

  it('runs bounded evaluation evidence, routes by its committed identity, and survives restart',async()=>{
    let state:State|undefined;
    const storage={read:()=>structuredClone(state),write:(value:State)=>{state=structuredClone(value);}};
    const host={check:vi.fn(),modelInfo:vi.fn(async()=>({})),complete:vi.fn(async()=>({text:'unused'}))};
    const first=new Engine(storage,host,{evaluationWorkerUrl});
    const accepted=await first.test(actor,definition(),{count:0},'evidence-accepted');
    expect(accepted).toMatchObject({state:'completed',result:'accepted',outputs:{gate:{passed:true,evaluatorNodeId:'evaluate'}}});
    expect(accepted.outputs.evaluate).toMatchObject({kind:'loops-evaluation',passed:true,evaluatorNodeId:'evaluate'});
    expect((accepted.outputs.evaluate as {evidenceDigest:string}).evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(accepted.context).toMatchObject({version:1,journal:[{nodeId:'evaluate',target:'/evaluation'}]});
    expect(host.complete).not.toHaveBeenCalled();
    const rejected=await first.test(actor,definition(),{count:-1},'evidence-rejected');
    expect(rejected).toMatchObject({state:'completed',result:'rejected',outputs:{evaluate:{passed:false,evaluatorNodeId:'evaluate'},gate:{passed:false}}});
    await first.close();
    const reopened=new Engine(storage,host,{evaluationWorkerUrl});
    try{expect(reopened.status(actor,accepted.id)).toMatchObject({result:'accepted',outputs:{evaluate:{evaluatorNodeId:'evaluate'},gate:{evidenceDigest:(accepted.outputs.gate as {evidenceDigest:string}).evidenceDigest}}});}
    finally{await reopened.close();}
  });
  it('persists safe evaluator failure codes and locations without committing downstream evidence',async()=>{
    const host={check:vi.fn(),modelInfo:vi.fn(async()=>({})),complete:vi.fn(async()=>({text:'unused'}))};
    const hangingWorkerUrl=pathToFileURL(new URL('./helpers/evaluation-hang-worker.mjs',import.meta.url).pathname);
    for(const [name,schema,input,worker,code] of [
      ['invalid-schema',{type:'not-a-type'},'x',evaluationWorkerUrl,'LOOPS_EVALUATION_SCHEMA_INVALID'],
      ['forbidden-reference',{$dynamicRef:'#local'},'x',evaluationWorkerUrl,'LOOPS_EVALUATION_REMOTE_REF'],
      ['resource-limit',{type:'string'},'x'.repeat(140000),evaluationWorkerUrl,'LOOPS_EVALUATION_RESOURCE_LIMIT'],
      ['timeout',{type:'string'},'x',hangingWorkerUrl,'LOOPS_EVALUATION_TIMEOUT'],
    ] as const){
      let state:State|undefined;
      const storage={read:()=>structuredClone(state),write:(value:State)=>{state=structuredClone(value);}};
      const candidate=definition();candidate.inputSchema=[{name:'text',label:'Text',type:'text',required:true}];
      const node=candidate.nodes.find(item=>item.id==='evaluate')!;
      if(node.kind!=='evaluate')throw Error('Evaluate fixture is missing');
      node.value='{{input.text}}';node.evaluator={kind:'json-schema-2020',version:'2020-12',schema};
      const engine=new Engine(storage,host,{evaluationWorkerUrl:worker});
      const run=await engine.test(actor,candidate,{text:input},name);
      expect(run).toMatchObject({state:'failed',errorDetail:{code,nodeId:'evaluate',phase:'execution',retryable:false}});
      expect(run.errorDetail?.message).not.toContain('not-a-type');
      expect(run.outputs).not.toHaveProperty('evaluate');expect(run.outputs).not.toHaveProperty('accepted');
      const reopened=new Engine(storage,host,{evaluationWorkerUrl:worker});
      expect(reopened.status(actor,run.id).errorDetail).toEqual(run.errorDetail);
      await reopened.close();await engine.close();
    }
    expect(host.complete).not.toHaveBeenCalled();
  });
  it('attributes evaluator cancellation before any downstream checkpoint',async()=>{
    let state:State|undefined;
    const storage={read:()=>structuredClone(state),write:(value:State)=>{state=structuredClone(value);}};
    const host={check:vi.fn(),modelInfo:vi.fn(async()=>({})),complete:vi.fn(async()=>({text:'unused'}))};
    const hangingWorkerUrl=pathToFileURL(new URL('./helpers/evaluation-hang-worker.mjs',import.meta.url).pathname);
    const controller=new AbortController(),candidate=definition();
    const engine=new Engine(storage,host,{evaluationWorkerUrl:hangingWorkerUrl});
    const pending=engine.test({...actor,signal:controller.signal},candidate,{count:0},'cancel-evaluator');
    setTimeout(()=>controller.abort(),40);
    const run=await pending;
    expect(run).toMatchObject({state:'failed',errorDetail:{code:'LOOPS_EVALUATION_CANCELLED',nodeId:'evaluate'}});
    expect(run.outputs).not.toHaveProperty('evaluate');expect(run.outputs).not.toHaveProperty('accepted');
    expect(new Engine(storage,host,{evaluationWorkerUrl:hangingWorkerUrl}).status(actor,run.id).errorDetail).toEqual(run.errorDetail);
    await engine.close();
  });
});
