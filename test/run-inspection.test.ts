import {describe,expect,it} from 'vitest';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {inspectionOutput,RunInspection} from '../src/run-inspection.js';
import {parseDefinition} from '../src/graph.js';
import type {Run} from '../src/engine.js';

const pinned=parseDefinition({schemaVersion:2,id:'published-loop',revision:3,slug:'pinned-loop',name:'Pinned published workflow',description:'immutable',inputSchema:[],capabilities:[],nodes:[{id:'input',kind:'input',label:'Pinned input'},{id:'repeat',kind:'repeat',label:'Pinned repeat',maxIterations:2,body:[{id:'body',kind:'inference',label:'Pinned body',prompt:'write',output:'text'},{id:'check',kind:'condition',label:'Pinned check',predicate:{left:'true',op:'truthy',right:''}}]},{id:'wait',kind:'wait',label:'Pinned wait',message:'wait'},{id:'return',kind:'return',label:'Pinned return',value:'{{nodes.repeat.text}}'}],edges:[{id:'a',source:'input',target:'repeat',port:'next'},{id:'b',source:'repeat',target:'wait',port:'next'},{id:'c',source:'wait',target:'return',port:'next'}],layout:{input:{x:0,y:0},repeat:{x:240,y:0},wait:{x:480,y:0},return:{x:720,y:0}},limits:{maxExecutions:20,maxOutputBytes:1048576}});
const run:Run={id:'child-run',requestKey:'request',requestFingerprint:'fingerprint',owner:{agentId:'agent',sessionKey:'session',sessionId:'session-id'},source:'session-action',parentRunId:'parent-run',definition:pinned,input:{},state:'waiting',cursor:'repeat',outputs:{repeat:{iterations:0,succeeded:false,value:null},wait:0},trace:[{nodeId:'input',kind:'input',state:'completed',startedAt:'2026-01-01T00:00:00.000Z',output:'{}'},{nodeId:'repeat',kind:'repeat',state:'completed',startedAt:'2026-01-01T00:00:01.000Z',output:'false'}],executions:2,activeMs:0,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:02.000Z'};
const render=(value=run)=>renderToStaticMarkup(React.createElement(RunInspection,{run:value,onSelectRun:()=>{},onExport:()=>{}}));

describe('run inspection',()=>{
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
    const html=render();expect(html).toContain('Inspect parent run');expect(html).toContain('Export run evidence');expect(html).toContain('Select executed node');expect(html).toContain('parent-run');
  });
});
