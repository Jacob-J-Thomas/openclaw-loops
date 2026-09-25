import {describe,expect,it,vi} from 'vitest';
import {evaluateTypedCondition,evaluateSwitch,validateSwitch} from '../src/branching.js';
import {typedConditionFrom,typedRewriteHint,caseDraftKey,hasActiveCaseDrafts} from '../src/branching-editor.js';
import {Engine,type Actor,type HostCapabilities,type Storage} from '../src/engine.js';
import {parseDefinition,resolveBinding,validateGraph,type Definition} from '../src/graph.js';

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
      const observed=typeof input==='string'?input:JSON.stringify(input);const run=await engine.test(actor,definition,{choice:input},'route-'+port);expect(run).toMatchObject({state:'completed',result,trace:expect.arrayContaining([expect.objectContaining({nodeId:'route',route:expect.objectContaining({port,observed})})])});
      const restored=new Engine(storage,host).status(actor,run.id);expect(restored.trace.find(step=>step.nodeId==='route')?.route).toMatchObject({port});
    }
    expect(host.complete).not.toHaveBeenCalled();expect(host.modelInfo).not.toHaveBeenCalled();
  });
  it('uses ordered cases deterministically and unique cases reject duplicate literals',()=>{
    const node={id:'switch',kind:'switch' as const,label:'Switch',value:{literalJson:'0'},strategy:'ordered' as const,cases:[{id:'first',label:'First',value:0},{id:'second',label:'Second',value:0}],default:true as const};
    expect(evaluateSwitch(node,value=>resolveBinding(value,{input:{},nodes:{}})).route.port).toBe('first');
    expect(validateSwitch({...node,strategy:'unique'}).join(' ')).toMatch(/duplicate/);
  });
  it('rejects structurally equal nested unique cases with the same equality used at routing',()=>{
    const node={id:'switch',kind:'switch' as const,label:'Switch',value:{literalJson:'0'},strategy:'unique' as const,cases:[
      {id:'first',label:'First',value:{outer:{a:1,b:[0,{ready:false}]}}},{id:'second',label:'Second',value:{outer:{b:[0,{ready:false}],a:1}}},
    ],default:true as const};
    expect(validateSwitch(node)).toContain('Switch has duplicate reachable case values (second and first).');
    expect(validateSwitch({...node,strategy:'ordered'})).toEqual([]);
  });
  it('converts only legacy equality predicates whose typed form is equivalent',()=>{
    const condition=(op:Extract<Definition['nodes'][number],{kind:'condition'}>['predicate']['op'])=>({id:'condition',kind:'condition' as const,label:'Condition',predicate:{left:'{{input.value}}',op,right:'{{input.expected}}'}});
    expect(typedConditionFrom(condition('equals'))?.condition).toEqual({value:'{{input.value}}',operator:'equals',expected:'{{input.expected}}'});
    expect(typedConditionFrom(condition('not-equals'))?.condition).toEqual({value:'{{input.value}}',operator:'not-equals',expected:'{{input.expected}}'});
    for(const operator of ['truthy','contains','less-than','greater-than'] as const){expect(typedConditionFrom(condition(operator))).toBeUndefined();expect(typedRewriteHint(operator)).toMatch(/explicitly/);}
  });
});
