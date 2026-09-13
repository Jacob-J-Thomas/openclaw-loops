import {describe,expect,it} from 'vitest';
import {insertBinding} from '../src/editor-operations.js';
import type {GraphNode} from '../src/graph.js';

describe('editor binding insertion',()=>{
  it('keeps standalone inference append and literal replacement behavior',()=>{
    const text:Extract<GraphNode,{kind:'inference'}>={id:'inference',kind:'inference',label:'Inference',prompt:'Summarize: ',output:'text',advanced:{temperature:0,maxTokens:128}};
    const literal:Extract<GraphNode,{kind:'inference'}>={...text,prompt:{literalJson:'{"subject":"literal"}'}};
    expect(insertBinding(text,'{{input.text}}')).toEqual({...text,prompt:'Summarize: {{input.text}}'});
    expect(insertBinding(literal,'{{input.text}}')).toEqual({...literal,prompt:'{{input.text}}'});
  });

  it('inserts into Repeat body prompts without changing its condition, identities, or inference settings',()=>{
    const repeat:Extract<GraphNode,{kind:'repeat'}>={id:'repeat',kind:'repeat',label:'Repeat',maxIterations:3,body:[
      {id:'draft',kind:'inference',label:'Draft',prompt:'Attempt ',output:'text',model:'fixture/model',agentId:'fixture-agent',reasoning:'low',advanced:{temperature:0,maxTokens:128}},
      {id:'check',kind:'condition',label:'Check',predicate:{left:'{{nodes.draft.text}}',op:'contains',right:'{{input.phrase}}'}},
    ]};
    const inserted=insertBinding(repeat,'{{repeat.index}}');
    expect(inserted).toEqual({...repeat,body:[{...repeat.body[0],prompt:'Attempt {{repeat.index}}'},repeat.body[1]]});
    expect(inserted).not.toBe(repeat);
  });

  it('replaces a v2 literal Repeat body prompt while retaining every unrelated body field',()=>{
    const repeat:Extract<GraphNode,{kind:'repeat'}>={id:'repeat',kind:'repeat',label:'Repeat',maxIterations:2,body:[
      {id:'draft',kind:'inference',label:'Draft',prompt:{literalJson:'{"draft":true}'},output:'json',model:'fixture/model',reasoning:'high',advanced:{temperature:0,maxTokens:64}},
      {id:'check',kind:'condition',label:'Check',predicate:{left:'{{nodes.draft.value}}',op:'truthy',right:''}},
    ]};
    expect(insertBinding(repeat,'{{repeat.index}}')).toEqual({...repeat,body:[{...repeat.body[0],prompt:'{{repeat.index}}'},repeat.body[1]]});
  });
});
