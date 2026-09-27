import {describe,expect,it} from 'vitest';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RunLauncher,captureWithRecoveryId,publishedDefinition,replaceCapturedFile,runInput,type FileRelease} from '../src/run-launcher.js';
import {parseDefinition} from '../src/graph.js';
import {LoopError} from '../src/errors.js';
import type {LoopRecord} from '../src/engine.js';
import type {Json} from '../src/graph.js';

const original=parseDefinition({schemaVersion:2,id:'editor-loop',revision:1,slug:'published-name',name:'Original publication',description:'Editor regression',inputSchema:[{name:'original',label:'Published input',type:'text',required:true}],capabilities:['llm'],nodes:[{id:'input',kind:'input',label:'Input'},{id:'infer',kind:'inference',label:'Inference',prompt:'{{input.original}}',output:'text',advanced:{temperature:0,maxTokens:128}},{id:'return',kind:'return',label:'Return',value:'{{input.original}}'}],edges:[{id:'a',source:'input',target:'infer',port:'next'},{id:'b',source:'infer',target:'return',port:'next'}],layout:{},limits:{maxExecutions:1000,maxOutputBytes:1048576}});
const draft={...original,revision:2,slug:'draft-name',inputSchema:[{name:'replacement',label:'Draft input',type:'text' as const,required:true}]};
const record:LoopRecord={definition:draft,enabledRevision:1,publishedRevision:1,revisions:{1:original,2:draft},grants:['llm']};
const render=(overrides:Partial<React.ComponentProps<typeof RunLauncher>>={})=>renderToStaticMarkup(React.createElement(RunLauncher,{draft,published:original,enabled:true,dirty:true,invalid:true,busy:false,authorized:true,onRun:async()=>{},onStageFile:async()=>null,onReleaseFile:async():Promise<FileRelease>=> 'released',onListFiles:async()=>({items:[],nextCursor:null}),onError:()=>{},...overrides}));

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

describe('file capture replacement custody',()=>{
  const reference=(id:string):Json=>({kind:'loops-artifact',id,runId:`capture-op-${id}`,nodeId:'upload',ownerScope:'a'.repeat(64),sha256:'b'.repeat(64),mediaType:'text/plain',bytes:1,createdAt:'2026-09-26T00:00:00.000Z',expiresAt:'2026-10-26T00:00:00.000Z'});
  const prior=reference('old'),newFile=reference('new');
  const deferred=<T>()=>{let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
  function harness(release:(reference:Json)=>Promise<FileRelease>,stage:()=>Promise<Json>,isCurrent=()=>true){
    const events:string[]=[],selection:{value:Json|undefined}={value:prior};
    const replace=()=>replaceCapturedFile({previous:selection.value,release,stage,isCurrent,
      onPreviousReleased:()=>{events.push('clear-old');selection.value=undefined;return true;},
      onCaptured:reference=>{events.push('select-new');selection.value=reference;return true;}});
    return {events,selection,replace};
  }
  it('confirms release and clears the old input before sending the replacement capture',async()=>{
    const ack=deferred<FileRelease>();
    const state=harness(async reference=>{expect(reference).toBe(prior);state.events.push('release-old');return ack.promise;},async()=>{state.events.push('capture-new');expect(state.selection.value).toBeUndefined();return newFile;});
    const pending=state.replace();expect(state.events).toEqual(['release-old']);ack.resolve('released');await pending;
    expect(state.events).toEqual(['release-old','clear-old','capture-new','select-new']);expect(state.selection.value).toBe(newFile);
  });
  it('keeps an acknowledged released input cleared if the replacement fails',async()=>{
    const state=harness(async()=> 'released',async()=>{throw new Error('quota or transport failure');});
    await expect(state.replace()).rejects.toThrow('quota or transport failure');expect(state.selection.value).toBeUndefined();expect(state.events).toEqual(['clear-old']);
  });
  it('does not capture or clear after denied or uncertain release',async()=>{
    for(const message of ['denied','lost acknowledgement']){
      let captures=0;const state=harness(async()=>{throw new Error(message);},async()=>{captures++;return newFile;});
      await expect(state.replace()).rejects.toThrow(message);expect(captures).toBe(0);expect(state.selection.value).toBe(prior);
    }
  });
  it('keeps a run-linked prior selection on replacement failure and permits a confirmed new selection',async()=>{
    const failure=harness(async()=> 'linked-protected',async()=>{throw new Error('new capture failed');});
    await expect(failure.replace()).rejects.toThrow('new capture failed');expect(failure.selection.value).toBe(prior);expect(failure.events).toEqual([]);
    const success=harness(async()=> 'linked-protected',async()=>newFile);await success.replace();expect(success.selection.value).toBe(newFile);expect(success.events).toEqual(['select-new']);
  });
  it('does not stage after selection generation changes during release',async()=>{
    const ack=deferred<FileRelease>();let current=true,captures=0;
    const state=harness(async()=>ack.promise,async()=>{captures++;return newFile;},()=>current);
    const pending=state.replace();current=false;ack.resolve('released');await pending;
    expect(captures).toBe(0);expect(state.selection.value).toBeUndefined();
  });
  it('releases a late new capture instead of selecting it under a changed owner or target',async()=>{
    const capture=deferred<Json>();let current=true;const released:Json[]=[];
    const state=harness(async reference=>{released.push(reference);return 'released';},()=>capture.promise,()=>current);
    const pending=state.replace();await Promise.resolve();current=false;capture.resolve(newFile);await pending;
    expect(released).toEqual([prior,newFile]);expect(state.selection.value).toBeUndefined();expect(state.events).toEqual(['clear-old']);
  });
  it('reports uncertain cleanup of a late new capture without committing it',async()=>{
    const capture=deferred<Json>();let current=true,calls=0;
    const state=harness(async()=>{calls++;if(calls===2)throw new Error('cleanup uncertain');return 'released';},()=>capture.promise,()=>current);
    const pending=state.replace();await Promise.resolve();current=false;capture.resolve(newFile);
    await expect(pending).rejects.toThrow('Captured file new');expect(state.selection.value).toBeUndefined();
  });
  it('releases a captured result if its input CAS no longer matches',async()=>{
    const released:Json[]=[];
    await replaceCapturedFile({previous:undefined,release:async reference=>{released.push(reference);return 'released';},stage:async()=>newFile,isCurrent:()=>true,
      onPreviousReleased:()=>{throw new Error('no previous file');},onCaptured:()=>false});
    expect(released).toEqual([newFile]);
  });
  it('does not stage a replacement when a released predecessor cannot be cleared from its original slot',async()=>{
    let staged=0;
    await expect(replaceCapturedFile({previous:prior,release:async()=> 'released',stage:async()=>{staged++;return newFile;},isCurrent:()=>true,
      onPreviousReleased:()=>false,onCaptured:()=>{throw new Error('must not select');}})).rejects.toThrow('selection changed');
    expect(staged).toBe(0);
  });
  it('leaves a newer definition slot untouched after an old-scope release settles',async()=>{
    const ack=deferred<FileRelease>();let current=true,staged=0;
    const pending=replaceCapturedFile({previous:prior,release:async()=>ack.promise,stage:async()=>{staged++;return newFile;},isCurrent:()=>current,
      onPreviousReleased:()=>false,onCaptured:()=>{throw new Error('must not select');}});
    current=false;ack.resolve('released');await pending;expect(staged).toBe(0);
  });
});

describe('capture uncertainty identity',()=>{
  const operationId='726ac8d1-1f8a-4426-b401-0142f35528f4';
  it('surfaces the exact recovery operation after a lost capture result without claiming publication',async()=>{
    const lost=new Error('transport acknowledgement lost');
    await expect(captureWithRecoveryId(operationId,async()=>{throw lost;})).rejects.toMatchObject({message:expect.stringContaining(operationId),cause:lost});
    const output=await captureWithRecoveryId(operationId,async()=>({kind:'loops-artifact',id:'ok'}));expect(output).toEqual({kind:'loops-artifact',id:'ok'});
  });
  it('retains the public failure code and puts the recovery ID first in a structured failure',async()=>{
    const rejection=new LoopError({code:'LOOPS_ARTIFACT_UNCERTAIN',message:'Capture outcome is uncertain.',phase:'operation',retryable:false,recovery:'Inspect publication.'});
    await expect(captureWithRecoveryId(operationId,async()=>{throw rejection;})).rejects.toMatchObject({detail:{code:'LOOPS_ARTIFACT_UNCERTAIN',message:expect.stringContaining(operationId),recovery:expect.stringContaining(operationId)},cause:rejection});
  });
});
