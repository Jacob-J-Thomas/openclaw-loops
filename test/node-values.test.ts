import {describe,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Value} from 'typebox/value';
import {Engine,type Actor,type HostCapabilities} from '../src/engine.js';
import {SqliteStorage} from '../src/storage.js';
import {bind,compare,parseDefinition,ports,validateGraph,DefinitionSchema,type Definition,type GraphNode} from '../src/graph.js';
import {literalValue,type Json,type NodeValue} from '../src/node-values.js';
import {nodeContract,nodeKinds,requiredCapabilities} from '../src/node-contracts.js';
import {copyDefinition,duplicateNode,revisionChanges} from '../src/editor-operations.js';
import {examples} from '../src/examples.js';

const literal=(value:Json)=>({literalJson:JSON.stringify(value)});
const actor:Actor={agentId:'main',sessionKey:'agent:main:json-values',sessionId:'json-values',source:'tool',human:false,check:()=>{}};
const host=():HostCapabilities=>({check:()=>{},modelInfo:vi.fn(async()=>({provider:'fixture',model:'fixture/test'})),complete:vi.fn(async(_actor,prompt)=>({text:prompt}))});
function definition(value:NodeValue=literal({count:0,ready:false})):Definition{
  return {...structuredClone(examples[0]),id:'json-values',slug:'json-values',revision:0,schemaVersion:2,inputSchema:[],capabilities:[],limits:{maxExecutions:1000,maxOutputBytes:100000},
    nodes:[{id:'input',kind:'input',label:'Input'},{id:'result',kind:'return',label:'Result',value}],edges:[{id:'next',source:'input',target:'result',port:'next'}]};
}

describe('explicit JSON node values',()=>{
  it.each([0,-2.5,false,null,'',[],{},[0,false,null],{rows:[{value:0}],text:'{{input.absent}}'}] as Json[])('preserves the type and contents of %j',value=>{
    const d=definition(literal(value));expect(parseDefinition(d)).toEqual(d);expect(validateGraph(d)).toEqual([]);
    expect(bind(literal(value),{input:{},nodes:{}})).toEqual(value);
  });
  it('does not coerce templates or interpolate literal text, even on malformed or unsafe binding paths',()=>{
    for(const text of ['2','false','null','{{input.absent}}','{{nodes.unknown.__proto__}}','{{unfinished']){
      expect(bind(literal(text),{input:{},nodes:{}})).toBe(text);expect(validateGraph(definition(literal(text)))).toEqual([]);
    }
    expect(compare({left:literal(2),op:'equals',right:'2'},{input:{},nodes:{}},2)).toBe(false);
    expect(compare({left:literal(2),op:'less-than',right:literal(10)},{input:{},nodes:{}},2)).toBe(true);
    expect(compare({left:literal([{x:0,y:false}]),op:'contains',right:literal({y:false,x:0})},{input:{},nodes:{}},2)).toBe(true);
    expect(compare({left:literal(true),op:'truthy',right:{literalJson:'{' }},{input:{},nodes:{}},2)).toBe(true);
  });
  it.each(['','{','undefined','NaN','1e999','{"__proto__":{}}','{"nested":{"constructor":0}}','[{"prototype":false}]','['.repeat(101)+'0'+']'.repeat(101)])('rejects consumed invalid or unsafe JSON source %s',source=>{
    // The source is a valid editable draft shape, but cannot be published/executed.
    const d=definition({literalJson:source});expect(parseDefinition(d)).toEqual(d);expect(validateGraph(d)).toContainEqual({nodeId:'result',message:expect.stringContaining('Literal JSON')});
    expect(()=>bind({literalJson:source},{input:{},nodes:{}})).toThrow(expect.objectContaining({detail:expect.objectContaining({code:'LOOPS_LITERAL_INVALID'})}));
  });
  it('accepts the documented depth boundary and leaves the original v1 schema unchanged',()=>{
    const source='['.repeat(100)+'0'+']'.repeat(100);expect(JSON.stringify(literalValue(source))).toBe(source);
    expect(createHash('sha256').update(readFileSync('examples/schema-v1.json')).digest('hex')).toBe('5c390b84f114329b893e93c15ee218323752fb0ad547dd2b2616c80fffec62d9');
    for(const legacy of examples)expect(parseDefinition(legacy)).toEqual(legacy);
    expect(()=>parseDefinition({...definition(),schemaVersion:1,limits:{...definition().limits,timeoutMs:1000}})).toThrow('Definition does not match schemaVersion 1, 2 or 3');
  });
  it('encodes the version relationship in the public schema before invoking an operation',()=>{
    const d=definition();d.limits.timeoutMs=1000;
    expect(Value.Check(DefinitionSchema,d)).toBe(true);expect(Value.Check(DefinitionSchema,{...d,schemaVersion:1})).toBe(false);
    const legacy={...definition('0'),schemaVersion:1,limits:{...d.limits}};expect(Value.Check(DefinitionSchema,legacy)).toBe(true);
    for(const schemaVersion of [1,2])expect(Value.Check(DefinitionSchema,{...legacy,schemaVersion,limits:{...legacy.limits,unknown:0}})).toBe(false);
    delete legacy.limits.timeoutMs;expect(Value.Check(DefinitionSchema,legacy)).toBe(false);expect(Value.Check(DefinitionSchema,{...legacy,schemaVersion:2})).toBe(true);
    const repeated=structuredClone(examples[1]);repeated.schemaVersion=2;const body=repeated.nodes.find(n=>n.kind==='repeat');if(body?.kind!=='repeat')throw Error();body.body[1].predicate.right=literal(5);
    expect(Value.Check(DefinitionSchema,repeated)).toBe(true);expect(Value.Check(DefinitionSchema,{...repeated,schemaVersion:1})).toBe(false);
  });
  it('validates every consumed field through the registry, including Repeat, but ignores truthy right JSON',()=>{
    const bad={literalJson:'{'},entries:Array<GraphNode>=[
      {id:'node',kind:'inference',label:'Inference',prompt:bad,output:'text'},
      {id:'node',kind:'condition',label:'Condition',predicate:{left:bad,op:'equals',right:literal(0)}},
      {id:'node',kind:'wait',label:'Wait',message:bad},{id:'node',kind:'review',label:'Review',proposal:bad},
      {id:'node',kind:'return',label:'Return',value:bad},{id:'node',kind:'fail',label:'Fail',reason:bad},
      {id:'node',kind:'repeat',label:'Repeat',maxIterations:6,body:[{id:'draft',kind:'inference',label:'Draft',prompt:bad,output:'text'},{id:'check',kind:'condition',label:'Check',predicate:{left:literal(true),op:'truthy',right:bad}}]},
    ];
    for(const node of entries){const d=definition();d.nodes.splice(1,0,node);expect(validateGraph(d)).toContainEqual({nodeId:'node',message:'Literal JSON must contain one complete JSON value.'});}
    const condition:GraphNode={id:'check',kind:'condition',label:'Check',predicate:{left:literal(true),op:'truthy',right:bad}},d=definition();d.nodes.splice(1,0,condition);d.edges=[{id:'entry',source:'input',target:'check',port:'next'},{id:'yes',source:'check',target:'result',port:'true'},{id:'no',source:'check',target:'result',port:'false'}];
    expect(validateGraph(d)).toEqual([]);condition.predicate.op='equals';expect(validateGraph(d)).toHaveLength(1);
  });
  it.each(nodeKinds)('%s validates legal ports and rejects a missing or unexpected outgoing edge',kind=>{
    let sequence=0;const node=nodeContract(kind).editor.create('node',prefix=>`${prefix}-${++sequence}`,6),d=definition();
    if(node.kind==='switch')d.schemaVersion=3;
    if(node.kind==='switch')node.value=literal(0);
    if(node.kind==='inference')node.prompt=literal('No inputs');
    if(node.kind==='condition')node.predicate={left:literal(0),op:'equals',right:literal(0)};
    if(node.kind==='repeat'){node.body[0].prompt=literal('No inputs');node.body[1].predicate={left:'{{repeat.index}}',op:'greater-than',right:literal(5)};}
    if(node.kind==='evaluate'){node.value=literal(0);d.schemaVersion=3;}
    if(node.kind==='wait')node.message=literal(null);if(node.kind==='review')node.proposal=literal(false);if(node.kind==='return')node.value=literal(0);
    // Lifecycle nodes are deliberately v3-only; the port registry remains
    // exhaustive without pretending a v2 graph can author context behavior.
    if(node.kind==='context-lifecycle')d.schemaVersion=3;
    if(node.kind==='memory'){
      d.schemaVersion=3;
      d.memoryPolicy={version:1,enabled:true,nodes:{node:{readPrefixes:['notes'],writeScopes:[],forgetPrefixes:[]}}};
    }
    d.nodes=kind==='input'?[node,d.nodes[1]]:nodeContract(kind).terminal?[d.nodes[0],node]:[d.nodes[0],node,d.nodes[1]];
    d.edges=[...kind==='input'?[]:[{id:'entry',source:'input',target:'node',port:'next' as const}],...ports(node).map(port=>({id:`node-${port}`,source:'node',target:'result',port}))];d.capabilities=requiredCapabilities(d.nodes);
    if(node.kind==='gate'){
      d.schemaVersion=3;
      const evaluation=nodeContract('evaluate').editor.create('evaluate',prefix=>`${prefix}-evidence`,6);evaluation.value=literal(0);
      d.nodes=[d.nodes[0],evaluation,node,d.nodes.at(-1)!];node.evaluationId=evaluation.id;
      d.edges=[{id:'entry',source:'input',target:evaluation.id,port:'next'},{id:'evidence',source:evaluation.id,target:'node',port:'next'},...ports(node).map(port=>({id:`node-${port}`,source:'node',target:'result',port}))];
      d.capabilities=requiredCapabilities(d.nodes);
    }
    expect(validateGraph(parseDefinition(d))).toEqual([]);
    if(d.edges.some(edge=>edge.source==='node')){const missing=structuredClone(d);missing.edges=missing.edges.filter(edge=>edge.id!==d.edges.find(edge=>edge.source==='node')!.id);expect(validateGraph(missing).some(issue=>issue.message.startsWith('Connect exactly one'))).toBe(true);}
    d.edges.push({id:'illegal',source:'node',target:nodeContract(kind).terminal?'node':'result',port:kind==='condition'||kind==='gate'?'next':node.kind==='switch'?'unexpected':'false'});expect(validateGraph(d)).toContainEqual({nodeId:'node',message:'Unexpected outgoing port.'});
  });
  it('duplicates Repeat template references without rewriting JSON literals and compares format changes',()=>{
    const d=structuredClone(examples[1]);d.schemaVersion=2;const source=d.nodes.find(n=>n.kind==='repeat')!;if(source.kind!=='repeat')throw Error();
    source.body[1].predicate.right=literal('{{nodes.draft.text}}');let id=0;const copy=duplicateNode(d,source.id,prefix=>`${prefix}-${++id}`),repeat=copy.nodes.at(-1)!;if(repeat.kind!=='repeat')throw Error();
    expect(repeat.body[1].predicate.left).toContain(`nodes.${repeat.body[0].id}.text`);expect(repeat.body[1].predicate.right).toEqual(literal('{{nodes.draft.text}}'));
    expect(revisionChanges(examples[1],d)).toContain('schemaVersion changed');
  });
});

describe('JSON values through durable execution',()=>{
  it('preserves v1 clone/import comparison semantics and budgets while new templates opt into v2 defaults',async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-copy-values-')),capabilities=host(),engine=new Engine(new SqliteStorage(join(root,'loops.sqlite')),capabilities);
    try{
      const legacy=definition('{{nodes.check.value}}');legacy.schemaVersion=1;legacy.limits={maxExecutions:42,timeoutMs:10000,maxOutputBytes:4096};legacy.nodes.splice(1,0,{id:'check',kind:'condition',label:'Legacy numeric',predicate:{left:'2',op:'less-than',right:'10'}});legacy.edges=[{id:'entry',source:'input',target:'check',port:'next'},{id:'yes',source:'check',target:'result',port:'true'},{id:'no',source:'check',target:'result',port:'false'}];
      engine.save(actor,legacy,0,true);const source=engine.load(actor,legacy.id).definition;
      for(const [name,original] of [['cloned',source],['imported',parseDefinition(JSON.parse(JSON.stringify(source)))]] as const){
        const copy=copyDefinition(original,name);expect(copy).toMatchObject({schemaVersion:1,revision:0,id:name,slug:name,limits:legacy.limits,nodes:legacy.nodes});expect((await engine.test(actor,copy,{},name)).result).toBe(true);
      }
      const template=copyDefinition(legacy,'new-template',{maxExecutions:1000,maxOutputBytes:100000});expect(template).toMatchObject({schemaVersion:2,limits:{maxExecutions:1000,timeoutMs:10000,maxOutputBytes:100000}});expect((await engine.test(actor,template,{},'template')).result).toBe(false);
      const json=definition({literalJson:'[0,false,null]'}),copy=copyDefinition(json,'json-copy');expect(parseDefinition(copy).nodes).toEqual(json.nodes);expect((await engine.test(actor,copy,{},'json-copy')).result).toEqual([0,false,null]);
      copy.nodes[1].label='Independent edit';expect(json.nodes[1].label).toBe('Result');expect(capabilities.complete).not.toHaveBeenCalled();
    }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
  });
  it('retains invalid drafts, valid publications and pinned v1 waits through SQLite restart, restore and import',async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-values-')),file=join(root,'loops.sqlite'),capabilities=host();let engine=new Engine(new SqliteStorage(file),capabilities);
    try{
      const legacy=definition('{{nodes.check.value}}');legacy.schemaVersion=1;legacy.limits.timeoutMs=10000;legacy.nodes.splice(1,0,{id:'wait',kind:'wait',label:'Wait',message:'Continue'},{id:'check',kind:'condition',label:'Check',predicate:{left:'2',op:'less-than',right:'10'}});legacy.edges=[{id:'a',source:'input',target:'wait',port:'next'},{id:'b',source:'wait',target:'check',port:'next'},{id:'yes',source:'check',target:'result',port:'true'},{id:'no',source:'check',target:'result',port:'false'}];
      engine.save(actor,legacy,0,true);const parked=await engine.run(actor,legacy.slug,{},'legacy-wait');expect(parked.state).toBe('waiting');
      const converted={...definition(),revision:1};engine.draft(actor,converted,1);engine.publish(actor,legacy.id,2,2);expect((await engine.run(actor,legacy.slug,{},'v2-published')).result).toEqual({count:0,ready:false});
      const invalid={...definition({literalJson:'{"unfinished":'}),revision:2};expect(engine.draft(actor,invalid,2)).toMatchObject({record:{enabledRevision:2,definition:{revision:3}},issues:[{nodeId:'result'}]});
      expect(()=>engine.publish(actor,legacy.id,3,3)).toThrow('Literal JSON');await expect(engine.test(actor,invalid,{},'invalid-test')).rejects.toThrow('Literal JSON');
      await engine.close();engine=new Engine(new SqliteStorage(file),capabilities);
      expect(engine.load(actor,legacy.id)).toMatchObject({enabledRevision:2,definition:{nodes:invalid.nodes}});expect((await engine.resume(actor,parked.id)).result).toBe(true);
      expect((await engine.run(actor,legacy.slug,{},'still-published')).result).toEqual({count:0,ready:false});
      const restored=engine.restore(actor,legacy.id,2,3);expect(restored.record).toMatchObject({enabledRevision:2,definition:{revision:4,nodes:converted.nodes}});
      const {id:_id,revision:_revision,schemaVersion:_version,...content}=JSON.parse(JSON.stringify(restored.record.definition)) as Definition;
      const imported=engine.create(actor,{...content,slug:'imported-values'});expect(imported.record.enabledRevision).toBe(1);expect((await engine.run(actor,'imported-values',{},'imported')).result).toEqual({count:0,ready:false});
      expect(capabilities.complete).not.toHaveBeenCalled();expect(capabilities.modelInfo).not.toHaveBeenCalled();
    }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
  });
  it('runs a zero-input graph with JSON prompts, six iterations, displayed JSON parks and explicit failure within execution budgets',async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-values-execution-')),capabilities=host(),engine=new Engine(new SqliteStorage(join(root,'loops.sqlite')),capabilities);
    try{
      const d=definition(literal([0,false,null]));d.nodes.splice(1,0,{id:'repeat',kind:'repeat',label:'Six',maxIterations:20,body:[{id:'draft',kind:'inference',label:'Draft',prompt:literal({text:'{{input.absent}}',count:0}),output:'json'},{id:'check',kind:'condition',label:'Check',predicate:{left:'{{repeat.index}}',op:'greater-than',right:literal(5)}}]},{id:'wait',kind:'wait',label:'Wait',message:literal({continue:true})},{id:'review',kind:'review',label:'Review',proposal:literal(false)});d.nodes.push({id:'fail',kind:'fail',label:'Fail',reason:literal({accepted:false})});d.capabilities=['llm'];d.edges=[{id:'a',source:'input',target:'repeat',port:'next'},{id:'b',source:'repeat',target:'wait',port:'next'},{id:'c',source:'wait',target:'review',port:'next'},{id:'yes',source:'review',target:'result',port:'approve'},{id:'no',source:'review',target:'fail',port:'reject'}];
      expect(validateGraph(d)).toEqual([]);const waiting=await engine.test(actor,d,{},'six');expect(waiting).toMatchObject({state:'waiting',pending:'{"continue":true}',outputs:{repeat:{iterations:6,succeeded:true,value:{text:'{{input.absent}}',count:0}}}});
      expect(vi.mocked(capabilities.complete).mock.calls.map(call=>call[1])).toEqual(Array(6).fill('{"text":"{{input.absent}}","count":0}'));
      expect(await engine.resume(actor,waiting.id)).toMatchObject({state:'review',pending:'false'});expect(await engine.review({...actor,human:true,source:'session-action'},waiting.id,'approve')).toMatchObject({state:'completed',result:[0,false,null]});
      const rejected=await engine.test(actor,d,{},'reject');await engine.resume(actor,rejected.id);expect(await engine.review({...actor,human:true,source:'session-action'},rejected.id,'reject')).toMatchObject({state:'failed',errorDetail:{code:'LOOPS_EXPLICIT_FAILURE',message:'{"accepted":false}'}});
      const count=vi.mocked(capabilities.complete).mock.calls.length;d.limits.maxExecutions=4;const bounded=await engine.test(actor,d,{},'budget');expect(bounded.state).toBe('failed');expect(bounded.error).toContain('execution');expect(vi.mocked(capabilities.complete).mock.calls.length-count).toBe(1);expect(bounded.trace.some(step=>step.nodeId==='wait')).toBe(false);
    }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
  });
});
