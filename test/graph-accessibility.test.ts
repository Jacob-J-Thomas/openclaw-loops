import {describe,expect,it} from 'vitest';
import {graphDeleteSelection,graphEdgeLabel,graphNodeLabel,replaceConnection,selectionChange} from '../src/graph-accessibility.js';
import {examples} from '../src/examples.js';

describe('graph accessibility and connection controls',()=>{
  it('deletes only the selected item focused in the authoring graph, never an input or another item',()=>{
    expect(graphDeleteSelection('Delete','node','input','input',null)).toEqual({nodeId:'input'});
    expect(graphDeleteSelection('Backspace','edge','a',null,'a')).toEqual({edgeId:'a'});
    expect(graphDeleteSelection('Delete',undefined,null,'input',null)).toBeUndefined();
    expect(graphDeleteSelection('Delete','node','wait','input',null)).toBeUndefined();
    expect(graphDeleteSelection('Enter','node','input','input',null)).toBeUndefined();
  });
  it('names nodes and connections with their authored meaning and selection action',()=>{
    const definition=examples[0],edge=definition.edges[0]!;
    expect(graphNodeLabel(definition.nodes[0]!)).toContain('Press Enter to select and edit this node.');
    expect(graphEdgeLabel(edge,definition.nodes)).toContain(`Connection from ${definition.nodes.find(node=>node.id===edge.source)?.label}`);
    expect(graphNodeLabel(definition.nodes[0]!,[],'inspect')).toContain('inspect its pinned evidence.');
    expect(graphEdgeLabel(edge,definition.nodes,'inspect')).toContain('Read-only connection.');
    expect(graphEdgeLabel(edge,definition.nodes,'inspect')).not.toContain('Press Enter');
  });

  it('replaces one source branch without changing unrelated authored connections',()=>{
    const definition=examples[0],edge=definition.edges[0]!,unrelated=definition.edges.at(-1)!;
    const next=replaceConnection(definition,{id:'keyboard-edge',source:edge.source,target:unrelated.target,port:edge.port});
    expect(next.edges).toContainEqual({id:'keyboard-edge',source:edge.source,target:unrelated.target,port:edge.port});
    expect(next.edges).not.toContainEqual(edge);
    expect(next.edges).toContainEqual(unrelated);
    expect(definition.edges).toContainEqual(edge);
  });

  it('keeps the final keyboard selection and clears a deselected controlled graph item',()=>{
    expect(selectionChange([{id:'input',type:'select',selected:false},{id:'review',type:'select',selected:true}])).toEqual({changed:true,selectedId:'review'});
    expect(selectionChange([{id:'review',type:'select',selected:false}])).toEqual({changed:true,selectedId:undefined});
    expect(selectionChange([{id:'review',type:'position'}])).toEqual({changed:false,selectedId:undefined});
  });
});
