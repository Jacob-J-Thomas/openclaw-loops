import {describe,expect,it} from 'vitest';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RunLauncher,publishedDefinition,runInput} from '../src/run-launcher.js';
import {parseDefinition} from '../src/graph.js';
import type {LoopRecord} from '../src/engine.js';

const original=parseDefinition({schemaVersion:2,id:'editor-loop',revision:1,slug:'published-name',name:'Original publication',description:'Editor regression',inputSchema:[{name:'original',label:'Published input',type:'text',required:true}],capabilities:['llm'],nodes:[{id:'input',kind:'input',label:'Input'},{id:'infer',kind:'inference',label:'Inference',prompt:'{{input.original}}',output:'text',advanced:{temperature:0,maxTokens:128}},{id:'return',kind:'return',label:'Return',value:'{{input.original}}'}],edges:[{id:'a',source:'input',target:'infer',port:'next'},{id:'b',source:'infer',target:'return',port:'next'}],layout:{},limits:{maxExecutions:1000,maxOutputBytes:1048576}});
const draft={...original,revision:2,slug:'draft-name',inputSchema:[{name:'replacement',label:'Draft input',type:'text' as const,required:true}]};
const record:LoopRecord={definition:draft,enabledRevision:1,publishedRevision:1,revisions:{1:original,2:draft},grants:['llm']};
const render=(overrides:Partial<React.ComponentProps<typeof RunLauncher>>={})=>renderToStaticMarkup(React.createElement(RunLauncher,{draft,published:original,enabled:true,dirty:true,invalid:true,busy:false,authorized:true,onRun:()=>{},onError:()=>{},...overrides}));

describe('independent published and draft execution targets',()=>{
  it('uses the enabled older publication and its own input while the newer draft is dirty and invalid',()=>{
    const selected=publishedDefinition(record,draft.id),before=structuredClone(record);expect(selected).toEqual(original);
    const html=render({published:selected});expect(html).toContain('Published r1');expect(html).toContain('published-name');expect(html).toContain('Published input');expect(html).not.toContain('Draft input');expect(html).toMatch(/<button[^>]*class="primary lp-run-button"[^>]*>▶ Run loop<\/button>/);expect(html).not.toContain('disabled=""');expect(record).toEqual(before);
    expect(selected?.nodes[1]).toMatchObject({advanced:{temperature:0,maxTokens:128}});expect(runInput(selected!,{original:'published value',replacement:'draft value'})).toEqual({original:'published value'});
  });
  it('keeps a disabled historical publication visible without silently replacing it with the current draft',()=>{
    expect(publishedDefinition({...record,enabledRevision:null},draft.id)).toEqual(original);
    const html=render({enabled:false});expect(html).toContain('Published r1 · disabled');expect(html).toContain('disabled=""');expect(html).toContain('Enable the published revision');expect(html).toContain('Current draft r2');
  });
  it('tests an unpublished draft without requiring activation',()=>{
    const html=render({published:null,enabled:false,invalid:false});expect(html).toContain('Draft input');expect(html).not.toContain('Published input');expect(html).toMatch(/<button[^>]*class="primary lp-run-button"[^>]*>Test current draft<\/button>/);expect(html).not.toMatch(/<button[^>]*disabled/);
  });
  it('does not borrow another loop or a missing historical revision when recovering local edits',()=>{
    expect(publishedDefinition(record,'another-loop')).toBeNull();expect(publishedDefinition(record,undefined)).toBeNull();expect(publishedDefinition({...record,revisions:{}},draft.id)).toBeNull();expect(publishedDefinition({...record,archived:true},draft.id)).toBeNull();expect(publishedDefinition({...record,deletedAt:'2026-09-13'},draft.id)).toBeNull();
    expect(publishedDefinition({definition:original,enabledRevision:1,grants:['llm']},original.id)).toEqual(original);
  });
  it('keeps explicit zero, false, null and optional omission in the chosen target input',()=>{
    const definition={...draft,inputSchema:[{name:'zero',label:'Zero',type:'number' as const,required:true},{name:'flag',label:'Flag',type:'boolean' as const,required:true},{name:'json',label:'JSON',type:'json' as const,required:true},{name:'optional',label:'Optional',type:'number' as const,required:false}]};
    expect(runInput(definition,{zero:0,flag:false,json:'null'})).toEqual({zero:0,flag:false,json:null});expect(runInput(definition,{zero:0,flag:false,json:'[0,false,null]',optional:0,unrelated:'omit'})).toEqual({zero:0,flag:false,json:[0,false,null],optional:0});
  });
  it('does not inject inherited object properties into optional inputs',()=>{
    const definition={...draft,inputSchema:[{name:'optional',label:'Optional',type:'text' as const,required:false}]};expect(runInput(definition,Object.create({optional:'inherited'}))).toEqual({});
  });
  it('rejects malformed structured input before invocation and supports zero-input workflows',()=>{
    expect(()=>runInput({...draft,inputSchema:[{name:'data',label:'JSON',type:'json',required:true}]},{data:'{'})).toThrow();expect(runInput({...draft,inputSchema:[]},{replacement:'not part of this target'})).toEqual({});
  });
});
