import {describe,expect,it} from 'vitest';
import {autoLayout} from '../src/editor-operations.js';
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

const withoutLayout=(definition:Definition)=>{const copy=structuredClone(definition);delete (copy as Partial<Definition>).layout;return copy;};
const finiteLayout=(definition:Definition)=>Object.values(definition.layout).every(position=>Number.isFinite(position.x)&&Number.isFinite(position.y));

describe('automatic graph layout',()=>{
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
});
