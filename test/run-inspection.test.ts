import {describe,expect,it} from 'vitest';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {contextPage,inspectionOutput,journalSource,readOnlyGraphAriaLabelConfig,RunInspection} from '../src/run-inspection.js';
import {parseDefinition} from '../src/graph.js';
import type {Run} from '../src/engine.js';
import {outputs} from '../src/output-schemas.js';
import {Value} from 'typebox/value';

const pinned=parseDefinition({schemaVersion:2,id:'published-loop',revision:3,slug:'pinned-loop',name:'Pinned published workflow',description:'immutable',inputSchema:[],capabilities:[],nodes:[{id:'input',kind:'input',label:'Pinned input'},{id:'repeat',kind:'repeat',label:'Pinned repeat',maxIterations:2,body:[{id:'body',kind:'inference',label:'Pinned body',prompt:'write',output:'text'},{id:'check',kind:'condition',label:'Pinned check',predicate:{left:'true',op:'truthy',right:''}}]},{id:'wait',kind:'wait',label:'Pinned wait',message:'wait'},{id:'return',kind:'return',label:'Pinned return',value:'{{nodes.repeat.text}}'}],edges:[{id:'a',source:'input',target:'repeat',port:'next'},{id:'b',source:'repeat',target:'wait',port:'next'},{id:'c',source:'wait',target:'return',port:'next'}],layout:{input:{x:0,y:0},repeat:{x:240,y:0},wait:{x:480,y:0},return:{x:720,y:0}},limits:{maxExecutions:20,maxOutputBytes:1048576}});
const run:Run={id:'child-run',requestKey:'request',requestFingerprint:'fingerprint',owner:{agentId:'agent',sessionKey:'session',sessionId:'session-id'},source:'session-action',parentRunId:'parent-run',definition:pinned,input:{},state:'waiting',cursor:'repeat',outputs:{repeat:{iterations:0,succeeded:false,value:null},wait:0},trace:[{nodeId:'input',kind:'input',state:'completed',startedAt:'2026-01-01T00:00:00.000Z',output:'{}'},{nodeId:'repeat',kind:'repeat',state:'completed',startedAt:'2026-01-01T00:00:01.000Z',output:'false'}],executions:2,activeMs:0,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:02.000Z'};
const render=(value=run)=>renderToStaticMarkup(React.createElement(RunInspection,{run:value,onSelectRun:()=>{},onExport:()=>{}}));

describe('run inspection',()=>{
  it('pages Unicode by code point and bounds literal provenance previews without splitting an emoji',()=>{
    expect(contextPage('🧪x',1)).toMatchObject({visible:'🧪',incomplete:true});
    const source=journalSource({kind:'literal',value:{literalJson:JSON.stringify('🧪'.repeat(600))}});
    expect(source).toContain('…');expect(source.slice(0,-1)).not.toMatch(/[\uD800-\uDBFF]$/);
  });
  it('renders escaped v3 context value and ordered committed provenance without treating it as markup',()=>{
    const definition=parseDefinition({...pinned,schemaVersion:3});
    const contextual:Run={...run,definition,context:{version:2,value:{input:{name:'🧪<script>alert(1)</script>'},result:{count:0,nullable:null}},journal:[
      {nodeId:'input',baseVersion:0,version:1,mode:'replace',target:'/result',source:{kind:'literal',value:{literalJson:'{"count":0}'}},valueSha256:'a'.repeat(64),valueBytes:11},
      {nodeId:'return',baseVersion:1,version:2,mode:'merge',target:'/result',source:{kind:'output',path:'/value'},valueSha256:'b'.repeat(64),valueBytes:4},
    ]}};
    const html=render(contextual);expect(html).toContain('Shared context provenance');expect(html).toContain('Context version 2');expect(html).toContain('Current shared context value');expect(html).toContain('Committed patch journal');expect(html).toContain('v0 → v1 · input');expect(html).toContain('v1 → v2 · return');expect(html).toContain('Resolved value SHA-256');expect(html).toContain('🧪&lt;script&gt;alert(1)&lt;/script&gt;');expect(html).toContain('/value');
  });
  it('states when an older run did not retain shared context',()=>expect(render()).toContain('This run has no shared context'));
  it('renders known null, explicit absence and legacy route previews without inventing operands',()=>{
    const evidence=run.trace[1],known:Run={...run,cursor:'repeat',trace:[run.trace[0],{...evidence,route:{port:'true',available:true,observed:'null'}}]};
    const unavailable:Run={...known,trace:[run.trace[0],{...evidence,route:{port:'false',available:false}}]};
    const legacy:Run={...known,trace:[run.trace[0],{...evidence,route:{port:'true',observed:'0'}}]};
    expect(Value.Check(outputs.completeRun,known)).toBe(true);
    expect(Value.Check(outputs.completeRun,unavailable)).toBe(true);
    expect(Value.Check(outputs.completeRun,legacy)).toBe(true);
    expect(Value.Check(outputs.completeRun,{...known,trace:[run.trace[0],{...evidence,route:{port:'true',available:true}}]})).toBe(false);
    expect(Value.Check(outputs.completeRun,{...known,trace:[run.trace[0],{...evidence,route:{port:'false',available:false,observed:'false'}}]})).toBe(false);
    expect(render(known)).toContain('observed <code>null</code>');
    expect(render(unavailable)).toContain('observed value unavailable');
    expect(render(legacy)).toContain('observed <code>0</code>');
  });
  it('renders the pinned definition, Repeat body settings, and readonly graph handles',()=>{
    const html=render();expect(html).toContain('Pinned published workflow');expect(html).toContain('Pinned repeat');expect(html).toContain('Pinned body');expect(html).toContain('read-only');expect(html).toContain('data-handleid="next"');
  });
  it.each([0,false,null])('keeps recorded scalar output %j distinct from missing evidence',value=>{
    const recorded={...run,parentRunId:undefined,outputs:{repeat:value}};expect(inspectionOutput(recorded,'repeat')).toEqual({label:'Recorded output',value});const html=render(recorded);expect(html).toContain('Recorded output');expect(html).toContain(String(value));
  });
  it('keeps a trace output distinct from missing and unstarted evidence',()=>{
    const withoutOutputs={...run,outputs:{}};expect(inspectionOutput(withoutOutputs,'repeat')).toEqual({label:'Recorded trace output',value:'false'});expect(inspectionOutput(withoutOutputs,'wait')).toEqual({label:'Node was not started'});
  });
  it('separates inherited recovery output from a value committed by this child attempt',()=>{
    const failedChild={...run,outputs:{repeat:0},trace:[{nodeId:'repeat',kind:'repeat',state:'failed' as const,startedAt:'2026-01-01T00:00:03.000Z',error:'interrupted'}]};expect(inspectionOutput(failedChild,'repeat')).toEqual({label:'Inherited from parent run',value:0});
    const committedChild={...run,outputs:{repeat:false},trace:[{nodeId:'repeat',kind:'repeat',state:'completed' as const,startedAt:'2026-01-01T00:00:03.000Z',output:'false'}]};expect(inspectionOutput(committedChild,'repeat')).toEqual({label:'Recorded in this recovery',value:false});
  });
  it('uses actual pending and completed Wait evidence instead of the empty checkpoint output',()=>{
    const parked={...run,cursor:'wait',state:'waiting' as const,pending:'Actual wait instruction',outputs:{wait:{}},trace:[]};expect(inspectionOutput(parked,'wait')).toEqual({label:'Pending Wait checkpoint',value:'Actual wait instruction'});
    const continued={...run,cursor:'return',state:'completed' as const,pending:undefined,outputs:{wait:{}},trace:[{nodeId:'wait',kind:'wait',state:'completed' as const,startedAt:'2026-01-01T00:00:03.000Z',output:'Actual wait instruction'}]};expect(inspectionOutput(continued,'wait')).toEqual({label:'Wait checkpoint evidence',value:'Actual wait instruction'});
  });
  it('uses the pending Human review proposal instead of its empty contract output',()=>{
    const reviewDefinition=parseDefinition({...pinned,nodes:[pinned.nodes[0],pinned.nodes[1],{id:'review',kind:'review',label:'Pinned review',proposal:'Approve this actual proposal'},{id:'return',kind:'return',label:'Pinned return',value:'{{nodes.repeat.text}}'}],edges:[{id:'a',source:'input',target:'repeat',port:'next'},{id:'b',source:'repeat',target:'review',port:'next'},{id:'c',source:'review',target:'return',port:'approve'}],layout:{input:{x:0,y:0},repeat:{x:240,y:0},review:{x:480,y:0},return:{x:720,y:0}}});
    const parked={...run,definition:reviewDefinition,cursor:'review',state:'review' as const,pending:'Actual proposal from execution',outputs:{review:{}},trace:[]};expect(inspectionOutput(parked,'review')).toEqual({label:'Pending Human review proposal',value:'Actual proposal from execution'});
  });
  it('directs inherited checkpoint placeholders to the parent without inventing checkpoint text',()=>{
    expect(inspectionOutput({...run,cursor:'return',outputs:{wait:{}},trace:[]},'wait')).toEqual({label:'See parent run for checkpoint evidence'});
  });
  it('keeps each completed review decision alongside its own proposal, independently of the latest run decision',()=>{
    const definition=parseDefinition({...pinned,nodes:[pinned.nodes[0],{id:'first',kind:'review',label:'First review',proposal:'First proposal'},{id:'second',kind:'review',label:'Second review',proposal:'Second proposal'},pinned.nodes[3],{id:'fail',kind:'fail',label:'Rejected',reason:'rejected'}],edges:[{id:'a',source:'input',target:'first',port:'next'},{id:'b',source:'first',target:'second',port:'approve'},{id:'c',source:'first',target:'fail',port:'reject'},{id:'d',source:'second',target:'return',port:'approve'},{id:'e',source:'second',target:'fail',port:'reject'}]});
    const reviewed:Run={...run,parentRunId:undefined,definition,cursor:'first',state:'failed',outputs:{first:{decision:'approve'},second:{decision:'reject'}},review:{decision:'reject',at:run.updatedAt,requester:'operator'},trace:[{nodeId:'first',kind:'review',state:'completed',startedAt:run.createdAt,output:'Bound first proposal'},{nodeId:'second',kind:'review',state:'completed',startedAt:run.updatedAt,output:'Bound second proposal'}]};
    expect(inspectionOutput(reviewed,'first')).toEqual({label:'Recorded output',value:{decision:'approve'},checkpoint:{label:'Human review proposal evidence',value:'Bound first proposal'}});
    expect(inspectionOutput(reviewed,'second')).toEqual({label:'Recorded output',value:{decision:'reject'},checkpoint:{label:'Human review proposal evidence',value:'Bound second proposal'}});
    const html=render(reviewed);expect(html).toContain('class="lp-checkpoint-output"');expect(html).toContain('Bound first proposal');expect(html).toContain('&quot;decision&quot;: &quot;approve&quot;');
  });
  it('retains an inherited review decision even when the proposal is only in its parent',()=>{
    const definition=parseDefinition({...pinned,nodes:pinned.nodes.map(node=>node.id==='wait'?{id:'wait',kind:'review',label:'Prior review',proposal:'Earlier proposal'}:node)});
    expect(inspectionOutput({...run,definition,cursor:'return',outputs:{wait:{decision:'approve'}},trace:[]},'wait')).toEqual({label:'Inherited from parent run',value:{decision:'approve'}});
  });
  it('renders parent inspection, export, and keyboard node selection controls',()=>{
    const html=render(),descriptionId='react-flow__node-desc-loops-executed-child-run';expect(html).toContain('Inspect parent run');expect(html).toContain('Export run evidence');expect(html).toContain('Select executed node');expect(html).toContain('parent-run');expect(html).toContain('inspect its pinned evidence.');expect(html).toContain('id="loops-executed-child-run"');expect((html.match(new RegExp(`id="${descriptionId}"`,'g'))??[])).toHaveLength(1);expect((html.match(new RegExp(`aria-describedby="${descriptionId}"`,'g'))??[])).toHaveLength(run.definition.nodes.length);expect(readOnlyGraphAriaLabelConfig['edge.a11yDescription.default']).toContain('Connections cannot be changed here.');expect(readOnlyGraphAriaLabelConfig['node.a11yDescription.keyboardDisabled']).not.toContain('delete');
  });
});
