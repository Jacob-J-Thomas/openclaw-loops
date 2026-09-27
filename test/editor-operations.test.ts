import {describe,expect,it} from 'vitest';
import {autoLayout,copyDefinition,revisionChanges,schemaVersionForAddedNode,withActiveTimeout} from '../src/editor-operations.js';
import {parseDefinition,validateGraph,type Definition} from '../src/graph.js';

const branching:Definition={schemaVersion:2,id:'arrange-fixture',slug:'arrange-fixture',name:'Arrange fixture',description:'Preserve authored graph data.',revision:3,inputSchema:[{name:'route',label:'Route',type:'boolean',required:true}],capabilities:['model-info'],nodes:[
  {id:'input',kind:'input',label:'Input'},
  {id:'condition',kind:'condition',label:'Choose route',predicate:{left:'{{input.route}}',op:'truthy',right:''}},
  {id:'left',kind:'action',label:'Left model',capability:'model-info'},
  {id:'right',kind:'action',label:'Right model',capability:'model-info'},
  {id:'return',kind:'return',label:'Return',value:'Completed'},
],edges:[
  {id:'entry',source:'input',target:'condition',port:'next'},
  {id:'left-edge',source:'condition',target:'left',port:'true'},
  {id:'right-edge',source:'condition',target:'right',port:'false'},
  {id:'left-join',source:'left',target:'return',port:'next'},
  {id:'right-join',source:'right',target:'return',port:'next'},
],layout:{input:{x:900,y:100},condition:{x:700,y:300},left:{x:500,y:500},right:{x:300,y:700},return:{x:100,y:900}},limits:{maxExecutions:20,maxOutputBytes:8192}};
const contextual:Definition={schemaVersion:3,id:'context-timeout',slug:'context-timeout',name:'Context timeout',description:'Preserve context and recursive data through timeout edits.',revision:4,
  inputSchema:[{name:'payload',label:'Payload',type:'json',required:true,schema:{type:'object',properties:{answer:{type:'number'}},required:['answer'],additionalProperties:false}}],capabilities:[],nodes:[
    {id:'input',kind:'input',label:'Input',context:{version:1,projection:{mode:'omit'},patch:{mode:'replace',target:'/answer',source:{kind:'literal',value:{literalJson:'0'}}}}},
    {id:'return',kind:'return',label:'Return',value:'{{context.answer}}',outputSchema:{type:'number'},context:{version:1,projection:{mode:'consume',paths:['/answer']},patch:{mode:'omit'}}},
  ],edges:[{id:'next',source:'input',target:'return',port:'next'}],layout:{input:{x:12,y:34},return:{x:56,y:78}},limits:{maxExecutions:2,maxOutputBytes:1024}};

const withoutLayout=(definition:Definition)=>{const copy=structuredClone(definition);delete (copy as Partial<Definition>).layout;return copy;};
const finiteLayout=(definition:Definition)=>Object.values(definition.layout).every(position=>Number.isFinite(position.x)&&Number.isFinite(position.y));
const chain=(schemaVersion:1|2,count:number,edges=true):Definition=>{
  const nodes:Definition['nodes']=[{id:'input',kind:'input',label:'Input'},...Array.from({length:count-2},(_,index)=>({id:`action-${index}`,kind:'action' as const,label:`Action ${index}`,capability:'model-info' as const})),{id:'return',kind:'return',label:'Return',value:'Done'}];
  return {schemaVersion,id:`chain-${schemaVersion}-${count}`,slug:`chain-${schemaVersion}-${count}`,name:'Layout chain',description:'Coordinate boundary regression.',revision:0,inputSchema:[],capabilities:['model-info'],nodes,edges:edges?nodes.slice(0,-1).map((node,index)=>({id:`edge-${index}`,source:node.id,target:nodes[index+1]!.id,port:'next' as const})):[],layout:Object.fromEntries(nodes.map(node=>[node.id,{x:0,y:0}])),limits:{maxExecutions:count+1,maxOutputBytes:4096,...schemaVersion===1?{timeoutMs:120000}:{}}};
};

describe('automatic graph layout',()=>{
  it('promotes palette additions for v3-only evaluation and Switch contracts without changing other node families',()=>{
    expect(schemaVersionForAddedNode(2,'evaluate')).toBe(3);
    expect(schemaVersionForAddedNode(2,'gate')).toBe(3);
    expect(schemaVersionForAddedNode(1,'evaluate')).toBe(3);
    expect(schemaVersionForAddedNode(2,'switch')).toBe(3);
    expect(schemaVersionForAddedNode(1,'switch')).toBe(3);
    expect(schemaVersionForAddedNode(3,'return')).toBe(3);
    expect(schemaVersionForAddedNode(2,'inference')).toBe(2);
  });
  it('arranges a valid branching join without changing its authored graph or settings',()=>{
    expect(validateGraph(branching)).toEqual([]);
    const before=structuredClone(branching),arranged=autoLayout(branching);
    expect(branching).toEqual(before);
    expect(withoutLayout(arranged)).toEqual(withoutLayout(before));
    expect(arranged.layout.input.x).toBeLessThan(arranged.layout.condition.x);
    expect(arranged.layout.condition.x).toBeLessThan(arranged.layout.left.x);
    expect(arranged.layout.left.x).toBe(arranged.layout.right.x);
    expect(arranged.layout.left.y).not.toBe(arranged.layout.right.y);
    expect(arranged.layout.left.x).toBeLessThan(arranged.layout.return.x);
    expect(parseDefinition(arranged)).toEqual(arranged);
  });

  it('keeps incomplete and cyclic drafts finite and editable',()=>{
    const incomplete:Definition={...structuredClone(branching),edges:[]};
    const cyclic:Definition={...structuredClone(branching),edges:[
      {id:'entry',source:'input',target:'condition',port:'next'},
      {id:'loop',source:'condition',target:'input',port:'true'},
    ]};
    for(const draft of [incomplete,cyclic]){
      expect(validateGraph(draft).length).toBeGreaterThan(0);
      const before=structuredClone(draft),arranged=autoLayout(draft);
      expect(arranged.nodes).toEqual(before.nodes);
      expect(arranged.edges).toEqual(before.edges);
      expect(arranged.inputSchema).toEqual(before.inputSchema);
      expect(arranged.limits).toEqual(before.limits);
      expect(finiteLayout(arranged)).toBe(true);
      expect(Object.keys(arranged.layout)).toEqual(arranged.nodes.map(node=>node.id));
    }
  });

  it.each([1,2] as const)('keeps a 39-node arranged v%s chain schema-valid without changing its authored graph',schemaVersion=>{
    const original=chain(schemaVersion,39),before=structuredClone(original),arranged=autoLayout(original);
    expect(validateGraph(arranged)).toEqual([]);
    expect(parseDefinition(arranged)).toEqual(arranged);
    expect(arranged.layout.return.x-arranged.layout.input.x).toBe(38*265);
    if(schemaVersion===1)expect(arranged.layout.return.x).toBe(10000);
    else expect(arranged.layout.return.x).toBeGreaterThan(10000);
    expect(withoutLayout(arranged)).toEqual(withoutLayout(before));
    expect(original).toEqual(before);
  });

  it.each([1,2] as const)('keeps a tall disconnected v%s draft schema-saveable while graph validation remains separate',schemaVersion=>{
    const draft=chain(schemaVersion,60,false),before=structuredClone(draft),arranged=autoLayout(draft);
    expect(validateGraph(arranged).length).toBeGreaterThan(0);
    expect(parseDefinition(arranged)).toEqual(arranged);
    expect(arranged.layout.return.y-arranged.layout.input.y).toBe(59*180);
    if(schemaVersion===1)expect(arranged.layout.return.y).toBe(10000);
    else expect(arranged.layout.return.y).toBeGreaterThan(10000);
    expect(withoutLayout(arranged)).toEqual(withoutLayout(draft));
    expect(draft).toEqual(before);
  });

  it('leaves an unrepresentable v1 draft unchanged until its author explicitly uses version 2',()=>{
    const original=chain(1,78),before=structuredClone(original);
    expect(()=>autoLayout(original)).toThrow('Use version 2 in this draft');
    expect(original).toEqual(before);
    const v2:Definition={...structuredClone(original),schemaVersion:2};
    const arranged=autoLayout(v2);
    expect(parseDefinition(arranged)).toEqual(arranged);
    expect(arranged.layout.return.x).toBeGreaterThan(10000);
  });

  it('keeps v1 coordinates within its frozen range while v2 accepts finite JavaScript-safe coordinates',()=>{
    const legacy=chain(1,2),v2=chain(2,2);
    expect(()=>parseDefinition({...legacy,layout:{input:{x:Number.MAX_SAFE_INTEGER,y:0},return:{x:0,y:0}}})).toThrow('Definition does not match schemaVersion 1, 2 or 3.');
    const safe={...v2,layout:{input:{x:Number.MAX_SAFE_INTEGER,y:-Number.MAX_SAFE_INTEGER},return:{x:0,y:0}}};
    expect(parseDefinition(safe)).toEqual(safe);
    for(const value of [Number.MAX_SAFE_INTEGER+1,NaN,Infinity,-Infinity])expect(()=>parseDefinition({...safe,layout:{...safe.layout,input:{x:value,y:0}}})).toThrow('Definition does not match schemaVersion 1, 2 or 3.');
  });
});

describe('active timeout authoring',()=>{
  it('promotes v1 and preserves v2/v3 across set, clear, and serialized reload',()=>{
    for(const [original,version] of [[chain(1,2),2],[branching,2],[contextual,3]] as const){
      const before=structuredClone(original),set=withActiveTimeout(original,123000),cleared=withActiveTimeout(set,undefined);
      expect(set.schemaVersion).toBe(version);expect(set.limits.timeoutMs).toBe(123000);expect(parseDefinition(set)).toEqual(set);expect(validateGraph(set)).toEqual([]);
      expect(cleared.schemaVersion).toBe(version);expect(cleared.limits).not.toHaveProperty('timeoutMs');expect(parseDefinition(cleared)).toEqual(cleared);expect(validateGraph(cleared)).toEqual([]);
      for(const value of [set,cleared]){
        const reloaded=parseDefinition(JSON.parse(JSON.stringify(value)));
        expect(reloaded.schemaVersion).toBe(version);expect(reloaded.nodes).toEqual(before.nodes);expect(reloaded.edges).toEqual(before.edges);
        expect(reloaded.inputSchema).toEqual(before.inputSchema);expect(reloaded.layout).toEqual(before.layout);
      }
      expect(original).toEqual(before);
    }
  });
  it('retains v3 context and recursive schemas through other editor operations',()=>{
    expect(parseDefinition(contextual)).toEqual(contextual);expect(validateGraph(contextual)).toEqual([]);
    expect(()=>parseDefinition({...contextual,schemaVersion:2})).toThrow('Definition does not match schemaVersion 1, 2 or 3.');
    const timed=withActiveTimeout(contextual,123000),arranged=autoLayout(timed),copied=copyDefinition(arranged,'context-timeout-copy',{maxExecutions:4,maxOutputBytes:2048});
    expect(arranged.schemaVersion).toBe(3);expect(arranged.limits.timeoutMs).toBe(123000);expect(arranged.nodes).toEqual(contextual.nodes);expect(arranged.inputSchema).toEqual(contextual.inputSchema);
    expect(copied.schemaVersion).toBe(3);expect(copied.limits).toEqual({maxExecutions:4,maxOutputBytes:2048,timeoutMs:123000});expect(copied.nodes).toEqual(contextual.nodes);expect(parseDefinition(copied)).toEqual(copied);
    expect(revisionChanges(contextual,timed)).toContain('limits changed');expect(revisionChanges(contextual,timed)).not.toContain('schemaVersion changed');
  });
});
