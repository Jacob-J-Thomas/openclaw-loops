import {describe,expect,it,vi} from 'vitest';
import {evaluateTypedCondition,evaluateSwitch,validateSwitch} from '../src/branching.js';
import {typedConditionFrom,typedRewriteHint,caseDraftKey,hasActiveCaseDrafts} from '../src/branching-editor.js';
import {Engine,type Actor,type HostCapabilities,type Storage} from '../src/engine.js';
import {parseDefinition,resolveBinding,validateGraph,type Definition} from '../src/graph.js';
import {SqliteStorage} from '../src/storage.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const actor:Actor={agentId:'branch',sessionKey:'agent:branch:test',sessionId:'branch-session',source:'tool',human:false,check:()=>{}};
class Memory implements Storage{state:ReturnType<Storage['read']>;read(){return structuredClone(this.state);}write(state:Parameters<Storage['write']>[0]){this.state=structuredClone(state);}}
function fixture():Definition{return {schemaVersion:3,id:'typed-branch',slug:'typed-branch',name:'Typed branch',description:'',revision:0,inputSchema:[{name:'choice',label:'Choice',type:'json',required:false}],capabilities:[],limits:{maxExecutions:20,maxOutputBytes:4096},nodes:[
  {id:'input',kind:'input',label:'Input'},
  {id:'route',kind:'switch',label:'Route',value:'{{input.choice}}',strategy:'unique',cases:[{id:'zero',label:'Zero',value:0},{id:'nil',label:'Null',value:null},{id:'false',label:'False',value:false},{id:'emoji',label:'Emoji',value:'🙂'}],default:true},
  {id:'zero-result',kind:'return',label:'Zero result',value:'{{nodes.route.value}}'},
  {id:'nil-result',kind:'return',label:'Null result',value:'null'},
  {id:'false-result',kind:'return',label:'False result',value:'false'},
  {id:'emoji-result',kind:'return',label:'Emoji result',value:'{{nodes.route.value}}'},
  {id:'default-result',kind:'return',label:'Default result',value:'default'},
],edges:[
  {id:'input-route',source:'input',target:'route',port:'next'},
  {id:'route-zero',source:'route',target:'zero-result',port:'zero'},
  {id:'route-nil',source:'route',target:'nil-result',port:'nil'},
  {id:'route-false',source:'route',target:'false-result',port:'false'},
  {id:'route-emoji',source:'route',target:'emoji-result',port:'emoji'},
  {id:'route-default',source:'route',target:'default-result',port:'default'},
],layout:{}};}
function conditionFixture(operator:'exists'|'missing'|'type-is'|'equals'|'not-equals',expected?:{literalJson:string},jsonType?:'null'):Definition{
  const definition=fixture();return {...definition,nodes:[definition.nodes[0],
    {id:'condition',kind:'condition',label:'Condition',predicate:{left:'{{input.choice}}',op:'equals',right:'null'},condition:{value:'{{input.choice}}',operator,...expected?{expected}:{},...jsonType?{jsonType}:{}}},
    {id:'yes',kind:'return',label:'Yes',value:{literalJson:'true'}},
    {id:'no',kind:'return',label:'No',value:{literalJson:'false'}},
  ],edges:[{id:'input-condition',source:'input',target:'condition',port:'next'},{id:'condition-yes',source:'condition',target:'yes',port:'true'},{id:'condition-no',source:'condition',target:'no',port:'false'}]};
}
describe('v3 typed branching',()=>{
  it('tracks invalid case drafts only while their exact saved case belongs to the active graph',()=>{
    const d=fixture(),route=d.nodes[1];if(route.kind!=='switch')throw Error();
    const drafts=new Map([[caseDraftKey(d.id,route.id,route.cases[0].id),'{']]);
    expect(hasActiveCaseDrafts(d,drafts)).toBe(true);
    expect(hasActiveCaseDrafts({...d,nodes:d.nodes.filter(node=>node.id!==route.id)},drafts)).toBe(false);
    expect(hasActiveCaseDrafts({...d,nodes:d.nodes.map(node=>node.id===route.id?{...route,cases:route.cases.slice(1)}:node)},drafts)).toBe(false);
    expect(hasActiveCaseDrafts(d,drafts)).toBe(true);
  });
  it('keeps missing distinct from null and fails ordinary unavailable comparisons',()=>{
    const resolve=(value:string|{literalJson:string})=>resolveBinding(value,{input:{nil:null,zero:0,off:false,empty:''},nodes:{}});
    expect(evaluateTypedCondition({value:'{{input.absent}}',operator:'missing'},resolve).passed).toBe(true);
    expect(evaluateTypedCondition({value:'{{input.nil}}',operator:'exists'},resolve).passed).toBe(true);
    expect(evaluateTypedCondition({value:'{{input.nil}}',operator:'type-is',jsonType:'null'},resolve).passed).toBe(true);
    expect(()=>evaluateTypedCondition({value:'{{input.absent}}',operator:'equals',expected:{literalJson:'null'}},resolve)).toThrow(/unavailable/);
    expect(evaluateTypedCondition({value:'{{input.zero}}',operator:'in',expected:{literalJson:'[0,false]'}},resolve).passed).toBe(true);
  });
  it('rejects invalid Switch cases and missing or duplicate edges before execution',()=>{
    const d=fixture(),route=d.nodes[1];if(route.kind!=='switch')throw Error();
    route.cases.push({id:'zero',label:'Duplicate',value:0});expect(validateSwitch(route).join(' ')).toMatch(/unique|duplicate/);
    route.cases.pop();d.edges=d.edges.filter(edge=>edge.port!=='emoji');expect(validateGraph(parseDefinition(d)).map(issue=>issue.message).join(' ')).toMatch(/emoji edge/);
    d.edges.push({id:'route-extra',source:'route',target:'default-result',port:'unknown'});expect(validateGraph(parseDefinition(d)).map(issue=>issue.message).join(' ')).toMatch(/Unexpected outgoing/);
  });
  it('routes exact typed values once, records bounded route evidence, and survives reload',async()=>{
    const storage=new Memory(),host:HostCapabilities={check:vi.fn(),complete:vi.fn(),modelInfo:vi.fn()};
    const engine=new Engine(storage,host),definition=fixture();
    for(const [input,result,port] of [[0,0,'zero'],[null,'null','nil'],[false,'false','false'],['🙂','🙂','emoji'],['other','default','default']] as const){
      const observed=typeof input==='string'?input:JSON.stringify(input);const run=await engine.test(actor,definition,{choice:input},'route-'+port);expect(run).toMatchObject({state:'completed',result,trace:expect.arrayContaining([expect.objectContaining({nodeId:'route',route:expect.objectContaining({port,available:true,observed})})])});
      const restored=new Engine(storage,host).status(actor,run.id);expect(restored.trace.find(step=>step.nodeId==='route')?.route).toMatchObject({port});
    }
    expect(host.complete).not.toHaveBeenCalled();expect(host.modelInfo).not.toHaveBeenCalled();
  });
  it('keeps defensive first-match behavior while rejecting duplicate ordered and unique cases before admission',async()=>{
    const node={id:'switch',kind:'switch' as const,label:'Switch',value:{literalJson:'0'},strategy:'ordered' as const,cases:[{id:'first',label:'First',value:0},{id:'second',label:'Second',value:0}],default:true as const};
    expect(evaluateSwitch(node,value=>resolveBinding(value,{input:{},nodes:{}})).route.port).toBe('first');
    expect(validateSwitch(node).join(' ')).toMatch(/duplicate/);
    expect(validateSwitch({...node,strategy:'unique'}).join(' ')).toMatch(/duplicate/);
    const definition=fixture(),route=definition.nodes[1];if(route.kind!=='switch')throw Error();
    route.strategy='ordered';route.cases[1].value=0;
    expect(validateGraph(parseDefinition(definition)).map(issue=>issue.message).join(' ')).toMatch(/duplicate reachable/);
    const storage=new Memory(),host:HostCapabilities={check:vi.fn(),complete:vi.fn(),modelInfo:vi.fn()},engine=new Engine(storage,host);
    expect(engine.validate(actor,definition).issues.map(issue=>issue.message).join(' ')).toMatch(/duplicate reachable/);
    await expect(engine.test(actor,definition,{choice:0},'duplicate-ordered')).rejects.toThrow(/duplicate reachable/);
    expect(storage.state?.runs??{}).toEqual({});expect(host.complete).not.toHaveBeenCalled();
  });
  it('rejects structurally equal nested unique cases with the same equality used at routing',()=>{
    const node={id:'switch',kind:'switch' as const,label:'Switch',value:{literalJson:'0'},strategy:'unique' as const,cases:[
      {id:'first',label:'First',value:{outer:{a:1,b:[0,{ready:false}]}}},{id:'second',label:'Second',value:{outer:{b:[0,{ready:false}],a:1}}},
    ],default:true as const};
    expect(validateSwitch(node)).toContain('Switch has duplicate reachable case values (second and first).');
    expect(validateSwitch({...node,strategy:'ordered'})).toContain('Switch has duplicate reachable case values (second and first).');
    const graph=fixture(),route=graph.nodes[1];if(route.kind!=='switch')throw Error();route.strategy='ordered';route.cases[1].value={outer:{a:1,b:[0,{ready:false}]}};route.cases[0].value={outer:{b:[0,{ready:false}],a:1}};
    expect(validateGraph(parseDefinition(graph)).map(issue=>issue.message).join(' ')).toMatch(/duplicate reachable/);
    route.cases[1].value=7;expect(validateGraph(parseDefinition(graph)).map(issue=>issue.message).join(' ')).not.toMatch(/duplicate reachable/);
  });
  it('rejects duplicate exhaustive boolean cases while distinct ordered cases remain valid',()=>{
    const graph=fixture(),route=graph.nodes[1];if(route.kind!=='switch')throw Error();route.strategy='ordered';route.default=undefined;route.exhaustive='boolean';route.cases=[{id:'yes',label:'Yes',value:true},{id:'also-yes',label:'Also yes',value:true},{id:'no',label:'No',value:false}];
    expect(validateSwitch(route).join(' ')).toMatch(/duplicate reachable/);
    route.cases.splice(1,1);expect(validateSwitch(route)).toEqual([]);
  });
  it('persists exact typed operands and explicit absence without changing route or boolean output',async()=>{
    const storage=new Memory(),host:HostCapabilities={check:vi.fn(),complete:vi.fn(),modelInfo:vi.fn()},engine=new Engine(storage,host);
    const cases=[
      {operator:'type-is' as const,jsonType:'null' as const,input:null,passed:true},
      {operator:'type-is' as const,jsonType:'null' as const,input:0,passed:false},
      {operator:'equals' as const,expected:{literalJson:'null'},input:null,passed:true},
      {operator:'equals' as const,expected:{literalJson:'null'},input:false,passed:false},
      {operator:'not-equals' as const,expected:{literalJson:'null'},input:null,passed:false},
      {operator:'not-equals' as const,expected:{literalJson:'null'},input:0,passed:true},
      ...[null,0,false,''].flatMap(input=>[{operator:'exists' as const,input,passed:true},{operator:'missing' as const,input,passed:false}]),
      {operator:'exists' as const,input:undefined,passed:false},{operator:'missing' as const,input:undefined,passed:true},
    ];
    for(const [index,item] of cases.entries()){
      const definition=conditionFixture(item.operator,'expected'in item?item.expected:undefined,'jsonType'in item?item.jsonType:undefined);
      const input=item.input===undefined?{}:{choice:item.input};
      const run=await engine.test(actor,definition,input,'typed-'+index);
      const route=run.trace.find(step=>step.nodeId==='condition')?.route;
      expect(run.state).toBe('completed');expect(run.result).toBe(item.passed);expect(run.outputs.condition).toEqual({value:item.passed});
      expect(route?.port).toBe(item.passed?'true':'false');
      const port=item.passed?'true':'false';
      if(item.input===undefined)expect(route).toEqual({port,available:false});
      else expect(route).toEqual({port,available:true,observed:typeof item.input==='string'?item.input:JSON.stringify(item.input)});
      expect(new Engine(storage,host).status(actor,run.id).trace.find(step=>step.nodeId==='condition')?.route).toEqual(route);
    }
    expect(host.complete).not.toHaveBeenCalled();
  });
  it('reopens SQLite with known null and unavailable route evidence intact',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'loops-branch-evidence-')),file=join(directory,'loops.sqlite'),host:HostCapabilities={check:vi.fn(),complete:vi.fn(),modelInfo:vi.fn()};
    let storage:SqliteStorage|undefined;
    try{
      storage=new SqliteStorage(file);const engine=new Engine(storage,host);
      const known=await engine.test(actor,conditionFixture('equals',{literalJson:'null'}),{choice:null},'sqlite-known');
      const absent=await engine.test(actor,conditionFixture('missing'),{},'sqlite-absent');
      await engine.close();storage=undefined;
      const reopened=new SqliteStorage(file);storage=reopened;const reader=new Engine(reopened,host);
      expect(reader.status(actor,known.id).trace.find(step=>step.nodeId==='condition')?.route).toEqual({port:'true',available:true,observed:'null'});
      expect(reader.status(actor,absent.id).trace.find(step=>step.nodeId==='condition')?.route).toEqual({port:'true',available:false});
      await reader.close();storage=undefined;
    }finally{if(storage)await storage.close();rmSync(directory,{recursive:true,force:true});}
  });
  it('bounds known Unicode route previews without splitting a code point',async()=>{
    const storage=new Memory(),host:HostCapabilities={check:vi.fn(),complete:vi.fn(),modelInfo:vi.fn()},engine=new Engine(storage,host),value='🙂'.repeat(600);
    const run=await engine.test(actor,conditionFixture('exists'),{choice:value},'unicode-route');
    expect(run.trace.find(step=>step.nodeId==='condition')?.route).toEqual({port:'true',available:true,observed:'🙂'.repeat(512),truncated:true});
  });
  it('converts only legacy equality predicates whose typed form is equivalent',()=>{
    const condition=(op:Extract<Definition['nodes'][number],{kind:'condition'}>['predicate']['op'])=>({id:'condition',kind:'condition' as const,label:'Condition',predicate:{left:'{{input.value}}',op,right:'{{input.expected}}'}});
    expect(typedConditionFrom(condition('equals'))?.condition).toEqual({value:'{{input.value}}',operator:'equals',expected:'{{input.expected}}'});
    expect(typedConditionFrom(condition('not-equals'))?.condition).toEqual({value:'{{input.value}}',operator:'not-equals',expected:'{{input.expected}}'});
    for(const operator of ['truthy','contains','less-than','greater-than'] as const){expect(typedConditionFrom(condition(operator))).toBeUndefined();expect(typedRewriteHint(operator)).toMatch(/explicitly/);}
  });
});
