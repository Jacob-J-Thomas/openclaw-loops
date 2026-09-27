import {describe,expect,it} from 'vitest';
import {deleteGraphNode,duplicateNode} from '../src/editor-operations.js';
import {parseDefinition,validateGraph} from '../src/graph.js';

const rule={readPrefixes:['notes'],writeScopes:[],forgetPrefixes:[]};
function draft(nodes:unknown){
  return parseDefinition({schemaVersion:3,id:'malformed-policy-draft',slug:'malformed-policy-draft',name:'Malformed policy draft',description:'',revision:0,
    inputSchema:[],capabilities:[],limits:{maxExecutions:4,maxOutputBytes:4096},layout:{},
    nodes:[{id:'input',kind:'input',label:'Input'},{id:'remember',kind:'memory',label:'Remember',memory:{operation:'inspect',key:'notes.fact'}},{id:'return',kind:'return',label:'Return',value:'done'}],
    edges:[{id:'a',source:'input',target:'remember',port:'next'},{id:'b',source:'remember',target:'return',port:'next'}],
    memoryPolicy:{version:1,enabled:true,...nodes===undefined?{}:{nodes}}});
}

describe('Memory policy graph mutations on recoverable invalid drafts',()=>{
  it.each([
    ['null',null],
    ['missing',undefined],
  ])('duplicates the graph node without repairing %s policy nodes',(_name,nodes)=>{
    const original=draft(nodes),before=structuredClone(original);
    expect(validateGraph(original).length).toBeGreaterThan(0);
    const copy=duplicateNode(original,'remember',()=> 'remember-copy');
    expect(copy.nodes.map(node=>node.id)).toContain('remember-copy');
    expect(copy.memoryPolicy).toEqual(before.memoryPolicy);
    expect(original).toEqual(before);
  });
  it.each([
    ['null',null],
    ['missing',undefined],
    ['string','invalid'],
    ['array',[rule]],
  ])('deletes Memory and unrelated Return nodes while preserving %s policy nodes',(_name,nodes)=>{
    const original=draft(nodes),before=structuredClone(original);
    for(const id of ['remember','return']){
      const deleted=deleteGraphNode(original,id);
      expect(deleted.nodes.some(node=>node.id===id)).toBe(false);
      expect(deleted.edges.some(edge=>edge.source===id||edge.target===id)).toBe(false);
      expect(deleted.memoryPolicy).toEqual(before.memoryPolicy);
    }
    expect(original).toEqual(before);
  });
  it('copies only the matching Memory rule with independent identity and preserves invalid siblings',()=>{
    const sibling={readPrefixes:'invalid',writeScopes:[null],forgetPrefixes:[]};
    const original=draft({remember:rule,sibling}),before=structuredClone(original);
    const copy=duplicateNode(original,'remember',()=> 'remember-copy');
    if(!copy.memoryPolicy?.enabled||!original.memoryPolicy?.enabled)throw Error('Expected enabled policy.');
    expect(copy.memoryPolicy.nodes['remember-copy']).toEqual(rule);
    expect(copy.memoryPolicy.nodes['remember-copy']).not.toBe(original.memoryPolicy.nodes.remember);
    expect(copy.memoryPolicy.nodes.remember).toBe(original.memoryPolicy.nodes.remember);
    expect(copy.memoryPolicy.nodes.sibling).toEqual(sibling);
    expect(original).toEqual(before);
  });
  it('removes only the deleted Memory rule from a record and never mutates history snapshots',()=>{
    const sibling={readPrefixes:'invalid',writeScopes:[null],forgetPrefixes:[]};
    const original=draft({remember:rule,sibling}),before=structuredClone(original);
    const unrelated=deleteGraphNode(original,'return');
    expect(unrelated.memoryPolicy).toBe(original.memoryPolicy);
    const deleted=deleteGraphNode(original,'remember');
    if(!deleted.memoryPolicy?.enabled)throw Error('Expected enabled policy.');
    expect(deleted.memoryPolicy.nodes).not.toHaveProperty('remember');
    expect(deleted.memoryPolicy.nodes.sibling).toEqual(sibling);
    expect(original).toEqual(before);
  });
});
