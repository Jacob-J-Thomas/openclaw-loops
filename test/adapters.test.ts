import {beforeAll,afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync,renameSync,readFileSync,writeFileSync,readdirSync,cpSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {Value} from 'typebox/value';
import {SqliteStorage} from '../src/storage.js';
import type {OpenClawPluginApi,OpenClawPluginToolContext,PluginCommandContext,PluginSessionActionRegistration,OpenClawPluginService,OpenClawPluginCommandDefinition} from 'openclaw/plugin-sdk/plugin-entry';
import sourcePlugin from '../src/index.js';
const plugin:typeof sourcePlugin=process.env.LOOPS_TEST_PLUGIN?(await import(/* @vite-ignore */ process.env.LOOPS_TEST_PLUGIN)).default:sourcePlugin;
import {parseCommand} from '../src/openclaw.js';
import {examples} from '../src/examples.js';
import {createLoopsClient} from '../src/feature-client.js';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FailureNotice,displayFailure} from '../src/failure-notice.js';
import {fitsFeatureJson} from '../src/feature-json.js';
import {createFeatureClient,type FeatureTransport} from 'openclaw/plugin-sdk/feature-contract';
import {wireContract,DocumentReferenceSchema} from '../src/wire-contract.js';
import type {LoopRecord,Run} from '../src/engine.js';
import type {RunReceipt} from '../src/receipts.js';
type ToolRegistration=Parameters<OpenClawPluginApi['registerTool']>[0];
import {execFileSync} from 'node:child_process';
beforeAll(()=>{if(!process.env.LOOPS_TEST_PLUGIN)execFileSync(process.execPath,['scripts/build.mjs'],{stdio:'pipe'});},30_000);
const directories:string[]=[];
const shutdowns:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const shutdown of shutdowns.splice(0))await shutdown();for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});});
async function setup(options?:{root?:string;start?:boolean;toolContext?:Partial<OpenClawPluginToolContext>;plugin?:typeof sourcePlugin}){
  const root=options?.root??mkdtempSync(join(tmpdir(),'loops-adapters-'));if(!options?.root)directories.push(root);
  const commands=new Map<string,OpenClawPluginCommandDefinition>(),actions=new Map<string,PluginSessionActionRegistration>(),registered:ToolRegistration[]=[];const services:OpenClawPluginService[]=[];
  const key='agent:main:adapter-test',sessionId='adapter-session';
  // The real published feature SDK registers these adapters. Only host capabilities are faked.
  const complete=vi.fn<OpenClawPluginApi['runtime']['llm']['complete']>(async()=>({text:'An actual adapter result.',provider:'fake',model:'test-only',agentId:'main',usage:{},execution:{mode:'isolated-agent-runtime',owner:{kind:'harness',id:'fake'}},audit:{caller:{kind:'plugin',id:'loops-poc'}}}));
  const config={plugins:{entries:{'loops-poc':{enabled:true}}}};
  const api={id:'loops-poc',config,runtime:{config:{current:()=>config},state:{resolveStateDir:()=>root},agent:{session:{getSessionEntry:({agentId,sessionKey}:{agentId:string;sessionKey:string})=>agentId==='main'&&sessionKey===key?{sessionId}:undefined}},llm:{complete},modelConfig:{resolveDefaultModelForAgent:()=>({provider:'fake',model:'test-only'})}},registerCommand:(c:OpenClawPluginCommandDefinition)=>commands.set(c.name,c),registerSessionAction:(a:PluginSessionActionRegistration)=>actions.set(a.id,a),registerTool:(t:ToolRegistration)=>registered.push(t),registerService:(s:OpenClawPluginService)=>services.push(s)} as unknown as OpenClawPluginApi;
  (options?.plugin??plugin).register(api);
  if(options?.start!==false)for(const s of services){await s.start({} as Parameters<OpenClawPluginService['start']>[0]);shutdowns.push(async()=>{await s.stop?.({} as Parameters<OpenClawPluginService['start']>[0]);});}
  const toolContext:OpenClawPluginToolContext={agentId:'main',sessionKey:key,sessionId,requesterSenderId:'host-sender',...options?.toolContext};
  const tools=registered.flatMap(t=>{const value=typeof t==='function'?t(toolContext):t;return Array.isArray(value)?value:value?[value]:[];});
  const commandContext={agentId:'main',sessionKey:key,sessionId,senderId:'host-sender',channel:'webchat',isAuthorizedSender:true,gatewayClientScopes:['operator.admin','operator.write'],config} as unknown as PluginCommandContext;
  const action=(id:string,payload:Record<string,unknown>,scopes=['operator.admin','operator.write','operator.read'])=>actions.get(id)!.handler({pluginId:'loops-poc',actionId:id,agentId:'main',sessionKey:key,payload:payload as never,client:{connId:'human',scopes}});
  return {root,commands,actions,tools,complete,commandContext,action,config,key,sessionId,services};
}
// Conversation consumers follow the same documented reference protocol. Check
// each formatted reply, not only the larger feature-SDK envelope.
async function commandJson(s:Awaited<ReturnType<typeof setup>>,op:string,input:unknown={}){
  const invoke=async(operation:string,payload:unknown)=>{
    const text=(await s.commands.get('loops')!.handler({...s.commandContext,args:`${operation} ${JSON.stringify(payload)}`})).text!;
    expect(text.length).toBeLessThanOrEqual(8000);return JSON.parse(text.split('\n\nRead the full JSON result with ')[0]);
  };
  const value=await invoke(op,input);if(!Value.Check(DocumentReferenceSchema,value))return value;
  let text='',offset=0;while(true){const page=await invoke('document',{documentId:value.documentId,offset});expect(page.sha256).toBe(value.sha256);expect(page.offset).toBe(offset);text+=page.text;if(page.nextOffset===null)break;expect(page.nextOffset).toBeGreaterThan(offset);offset=page.nextOffset;}
  expect(Buffer.byteLength(text)).toBe(value.bytes);expect(createHash('sha256').update(text).digest('hex')).toBe(value.sha256);return JSON.parse(text);
}
async function toolJson(s:Awaited<ReturnType<typeof setup>>,name:string,input:Record<string,unknown>,callId=`fixture-${name}`){
  const invoke=async(name:string,input:Record<string,unknown>)=>{
    const result=await s.tools.find(t=>t.name===`loops_${name}`)!.execute(callId,input);
    for(const content of result.content)if(content.type==='text')expect(content.text.length).toBeLessThanOrEqual(8000);
    expect(JSON.stringify({tool:{id:`openclaw:loops-poc:loops_${name}`,name:`loops_${name}`,source:'openclaw'},result},null,2).length).toBeLessThanOrEqual(16000);return result.details;
  };
  const value=await invoke(name,input);if(!Value.Check(DocumentReferenceSchema,value))return value as Record<string,unknown>;
  let text='',offset=0;while(true){const page=await invoke('document',{documentId:value.documentId,offset}) as {text:string;offset:number;nextOffset:number|null;sha256:string};expect(page.offset).toBe(offset);expect(page.sha256).toBe(value.sha256);text+=page.text;if(page.nextOffset===null)break;expect(page.nextOffset).toBeGreaterThan(offset);offset=page.nextOffset;}
  expect(Buffer.byteLength(text)).toBe(value.bytes);expect(createHash('sha256').update(text).digest('hex')).toBe(value.sha256);return JSON.parse(text);
}
describe('actual OpenClaw feature SDK adapters (fake model transport)',()=>{
  it.each(['ui','command','tool'] as const)('requires a new human decision after %s restart while retaining approval for retry-node continuation',async surface=>{
    let s=await setup(),sequence=0;
    const transport={pluginId:'loops-poc',signal:new AbortController().signal,connection:{connected:true},onEvent:()=>()=>{},subscribe:()=>()=>{},request:async(_method:string,params:Record<string,unknown>)=>s.action(params.actionId as string,params.payload as Record<string,unknown>)} as FeatureTransport;
    const client=createLoopsClient(transport);
    const invoke=(op:Parameters<typeof client.invoke>[0],input:Record<string,unknown>={}):Promise<unknown>=>surface==='command'?commandJson(s,op,input):surface==='tool'?toolJson(s,op==='load'?'read':op,input,`recovery-${++sequence}`):client.invoke(op,input as never);
    const definition={slug:`review-restart-${surface}`,name:'Fresh review on restart',description:'Recovery must distinguish retained and repeated decisions.',inputSchema:[],capabilities:[],nodes:[{id:'input',kind:'input',label:'Input'},{id:'review',kind:'review',label:'Review',proposal:'Approve this attempt?'},{id:'wait',kind:'wait',label:'Wait',message:'Hold after approval'},{id:'return',kind:'return',label:'Return',value:'Accepted'},{id:'reject',kind:'fail',label:'Reject',reason:'Rejected'}],edges:[{id:'a',source:'input',target:'review',port:'next'},{id:'b',source:'review',target:'wait',port:'approve'},{id:'c',source:'review',target:'reject',port:'reject'},{id:'d',source:'wait',target:'return',port:'next'}],layout:{},limits:{maxExecutions:1000,maxOutputBytes:1048576}};
    await invoke('create',{definition});const first=await invoke('run',{slug:definition.slug,input:{},requestId:'original'}) as RunReceipt;expect(first.state).toBe('review');
    await client.invoke('review',{runId:first.id,decision:'approve'});await invoke('cancel',{runId:first.id});const original=await invoke('inspect',{runId:first.id}) as Run;expect(original.review?.decision).toBe('approve');
    const continuation=await invoke('retry',{runId:first.id,mode:'retry-node',requestId:'continue-approved'}) as RunReceipt;expect(continuation).toMatchObject({state:'waiting',parentRunId:first.id});
    expect((await invoke('inspect',{runId:continuation.id}) as Run).review).toEqual(original.review);expect(await invoke('resume',{runId:continuation.id})).toMatchObject({state:'completed'});
    const restarted=await invoke('retry',{runId:first.id,mode:'restart',requestId:'restart-review'}) as RunReceipt;expect(restarted).toMatchObject({state:'review',parentRunId:first.id});
    const pending=await invoke('inspect',{runId:restarted.id}) as Run;expect(pending.review).toBeUndefined();expect(pending.outputs.review).toEqual({});
    expect(await invoke('inspect',{runId:first.id})).toEqual(original);
    for(const shutdown of shutdowns.splice(0))await shutdown();
    // Previous releases persisted the parent's attribution on this fresh child.
    // Exercise the indexed cold-run path, including idempotent admission first.
    const filename=join(s.root,'loops-poc','loops.sqlite'),store=new SqliteStorage(filename);
    store.writeRun({...pending,review:original.review});await store.close();s=await setup({root:s.root});
    const fault=new DatabaseSync(filename);
    try{
      fault.exec("CREATE TRIGGER reject_attribution_repair BEFORE UPDATE ON runs BEGIN SELECT RAISE(FAIL,'Synthetic attribution repair failure'); END");
      const request={runId:first.id,mode:'restart',requestId:'restart-review'};
      if(surface==='ui')await expect(invoke('retry',request)).rejects.toMatchObject({message:'Loops storage rejected a conflicting write.'});
      else if(surface==='command')expect((await s.commands.get('loops')!.handler({...s.commandContext,args:`retry ${JSON.stringify(request)}`})).text).toContain('Loops storage rejected a conflicting write.');
      else expect(await invoke('retry',request)).toMatchObject({kind:'loops-error',error:{message:'Loops storage rejected a conflicting write.'}});
      expect(JSON.parse((fault.prepare('SELECT record FROM runs WHERE id=?').get(restarted.id) as {record:string}).record).review).toEqual(original.review);
      fault.exec('DROP TRIGGER reject_attribution_repair');
    }finally{fault.close();}
    const duplicate=await invoke('retry',{runId:first.id,mode:'restart',requestId:'restart-review'}) as RunReceipt;
    expect(duplicate).toMatchObject({id:restarted.id,state:'review'});expect(duplicate.review).toBeUndefined();
    expect(await invoke('inspect',{runId:restarted.id})).toEqual(pending);
    const database=new DatabaseSync(filename,{readOnly:true});
    try{expect(JSON.parse((database.prepare('SELECT record FROM runs WHERE id=?').get(restarted.id) as {record:string}).record)).toEqual(pending);}finally{database.close();}
    for(const shutdown of shutdowns.splice(0))await shutdown();s=await setup({root:s.root});
    expect(await invoke('inspect',{runId:restarted.id})).toEqual(pending);
    expect(await client.invoke('review',{runId:restarted.id,decision:'reject'})).toMatchObject({state:'failed'});expect((await invoke('inspect',{runId:restarted.id}) as Run).review?.decision).toBe('reject');
    expect(await invoke('inspect',{runId:first.id})).toEqual(original);expect(s.complete).not.toHaveBeenCalled();
  });
  it.each(['ui','command','tool'] as const)('preserves published inputs, Advanced overrides and pinned waits through the complete %s version lifecycle',async surface=>{
    let s=await setup(),sequence=0;
    const transport={pluginId:'loops-poc',signal:new AbortController().signal,connection:{connected:true},onEvent:()=>()=>{},subscribe:()=>()=>{},request:async(_method:string,params:Record<string,unknown>)=>s.action(params.actionId as string,params.payload as Record<string,unknown>)} as FeatureTransport;
    const client=createLoopsClient(transport);
    const invoke=(op:Parameters<typeof client.invoke>[0],input:Record<string,unknown>={}):Promise<unknown>=>surface==='command'?commandJson(s,op,input):surface==='tool'?toolJson(s,op==='load'?'read':op,input,`versions-${++sequence}`):client.invoke(op,input as never);
    const definition={slug:'version-published',name:'Published version',description:'Version lifecycle fixture',inputSchema:[{name:'original',label:'Published input',type:'text',required:true}],capabilities:['llm'],nodes:[{id:'input',kind:'input',label:'Input'},{id:'wait',kind:'wait',label:'Wait',message:'Hold this version'},{id:'infer',kind:'inference',label:'Inference',model:'fake/test-only',prompt:'{{input.original}}',output:'text',advanced:{temperature:0,maxTokens:128}},{id:'return',kind:'return',label:'Return',value:'{{input.original}}'}],edges:[{id:'a',source:'input',target:'wait',port:'next'},{id:'b',source:'wait',target:'infer',port:'next'},{id:'c',source:'infer',target:'return',port:'next'}],layout:{},limits:{maxExecutions:1000,maxOutputBytes:1048576}};
    const created=(await invoke('create',{definition}) as {record:LoopRecord}).record,id=created.definition.id;
    const original=await invoke('run',{slug:definition.slug,input:{original:'Original run'},requestId:'original'}) as RunReceipt,before=await invoke('inspect',{runId:original.id});expect(original.state).toBe('waiting');
    const draft={...created.definition,slug:'version-draft',inputSchema:[{name:'replacement',label:'Draft input',type:'text',required:true}],nodes:created.definition.nodes.map(node=>node.kind==='inference'?{...node,prompt:'{{input.replacement}}',advanced:{temperature:0.5,maxTokens:256}}:node.kind==='return'?{...node,value:'{{input.replacement}}'}:node)};
    const saved=(await invoke('draft',{definition:draft,expectedRevision:1}) as {record:LoopRecord}).record;expect(saved).toMatchObject({enabledRevision:1,publishedRevision:1,definition:{revision:2}});
    expect(await invoke('describe',{slug:definition.slug})).toMatchObject({revision:1,inputSchema:[{name:'original'}]});
    const tested=await invoke('test',{definition:saved.definition,input:{replacement:'Draft test'},requestId:'draft'}) as RunReceipt;
    const published=await invoke('run',{slug:definition.slug,input:{original:'Published run'},requestId:'published'}) as RunReceipt;
    expect(tested).toMatchObject({state:'waiting',testMode:true,definition:{revision:2}});expect(published).toMatchObject({state:'waiting',definition:{revision:1}});
    expect(await invoke('enable',{id,revision:2,enabled:false})).toMatchObject({enabledRevision:null,publishedRevision:1});
    expect(await invoke('save',{definition:saved.definition,expectedRevision:2,enabled:false})).toMatchObject({record:{enabledRevision:null,definition:{revision:3}}});
    const restored=(await invoke('restore',{id,revision:1,expectedRevision:3}) as {record:LoopRecord}).record;expect(restored.definition.nodes[2]).toMatchObject({advanced:{temperature:0,maxTokens:128}});
    expect(await invoke('publish',{id,revision:2,expectedRevision:4})).toMatchObject({enabledRevision:2,publishedRevision:2,definition:{revision:4}});
    expect(await invoke('publish',{id,revision:1,expectedRevision:4})).toMatchObject({enabledRevision:1,publishedRevision:1});
    expect(await invoke('archive',{id,expectedRevision:4,archived:true})).toMatchObject({archived:true,enabledRevision:null});
    expect(await invoke('recover',{id,expectedRevision:4})).toMatchObject({archived:false,enabledRevision:null});expect(await invoke('inspect',{runId:original.id})).toEqual(before);expect(s.complete).not.toHaveBeenCalled();
    for(const shutdown of shutdowns.splice(0))await shutdown();s=await setup({root:s.root});expect(await invoke('inspect',{runId:original.id})).toEqual(before);
    for(const [run,result] of [[original,'Original run'],[tested,'Draft test'],[published,'Published run']] as const)expect(await invoke('resume',{runId:run.id})).toMatchObject({state:'completed',result});
    expect(s.complete.mock.calls.map(([request])=>({temperature:request.temperature,maxTokens:request.maxTokens}))).toEqual([{temperature:0,maxTokens:128},{temperature:0.5,maxTokens:256},{temperature:0,maxTokens:128}]);
    const completed=await invoke('inspect',{runId:original.id});await invoke('delete',{id,expectedRevision:4});expect(await invoke('recover',{id,expectedRevision:4})).toMatchObject({enabledRevision:null,definition:restored.definition});expect(await invoke('inspect',{runId:original.id})).toEqual(completed);expect(await invoke('versions',{id})).toMatchObject([{revision:4},{revision:3},{revision:2},{revision:1}]);
  },30000);
  it.each(['ui','command','tool'] as const)('preserves current and published slug reservations through %s lifecycle operations',async surface=>{
    const s=await setup();let sequence=0;
    const invoke=async(op:string,input:Record<string,unknown>={})=>{
      if(surface==='tool')return toolJson(s,op==='load'?'read':op,input,`namespace-${++sequence}`);
      if(surface==='command')return commandJson(s,op,input);
      const response=await s.action(op,input);if(!response?.ok)throw Error(JSON.stringify(response));return response.result;
    };
    const failure=async(op:string,input:Record<string,unknown>)=>surface==='command'?
      (await s.commands.get('loops')!.handler({...s.commandContext,args:`${op} ${JSON.stringify(input)}`})).text:JSON.stringify(await invoke(op,input));
    const definition=(slug:string)=>({slug,name:slug,description:'Namespace adapter fixture',inputSchema:[],capabilities:[],nodes:[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:slug}],edges:[{id:'edge',source:'input',target:'return',port:'next'}],layout:{},limits:{maxExecutions:1000,maxOutputBytes:1048576}});
    const a=(await invoke('create',{definition:definition('occupied')})).record;
    await invoke('edit',{id:a.definition.id,expectedRevision:1,changes:{slug:'renamed-a'},enabled:true});const b=(await invoke('create',{definition:definition('occupied')})).record;
    const before=await invoke('load',{id:a.definition.id});expect(await failure('publish',{id:a.definition.id,revision:1,expectedRevision:2})).toContain('LOOPS_SLUG_CONFLICT');expect(await invoke('load',{id:a.definition.id})).toEqual(before);
    await invoke('edit',{id:b.definition.id,expectedRevision:1,changes:{slug:'renamed-b'},enabled:true});expect((await invoke('publish',{id:a.definition.id,revision:1,expectedRevision:2})).enabledRevision).toBe(1);
    const c=(await invoke('create',{definition:definition('recovered')})).record;await invoke('delete',{id:c.definition.id,expectedRevision:1});
    const d=(await invoke('create',{definition:definition('recovered')})).record;await invoke('draft',{definition:{...d.definition,slug:'renamed-d'},expectedRevision:1});
    const hidden=await invoke('deleted'),published=await invoke('load',{id:d.definition.id});expect(await failure('recover',{id:c.definition.id,expectedRevision:1})).toContain('LOOPS_SLUG_CONFLICT');expect(await invoke('deleted')).toEqual(hidden);expect(await invoke('load',{id:d.definition.id})).toEqual(published);
    await invoke('enable',{id:d.definition.id,revision:2,enabled:false});expect((await invoke('recover',{id:c.definition.id,expectedRevision:1})).enabledRevision).toBeNull();expect((await invoke('enable',{id:c.definition.id,revision:1,enabled:true})).enabledRevision).toBe(1);expect(s.complete).not.toHaveBeenCalled();
  });
  it('refuses ambiguous legacy publication through registered UI, command and tool paths after restart without any completion',async()=>{
    let s=await setup();
    const action=async(op:string,payload:Record<string,unknown>={})=>{const response=await s.action(op,payload);if(!response?.ok)throw Error(JSON.stringify(response));return response.result;};
    const definition={slug:'occupied',name:'Namespace fixture',description:'Legacy publication fixture',inputSchema:[],capabilities:['llm'],nodes:[{id:'input',kind:'input',label:'Input'},{id:'infer',kind:'inference',label:'Inference',model:'fake/test-only',prompt:'Count a fixture completion.',output:'text'},{id:'return',kind:'return',label:'Return',value:'{{nodes.infer.text}}'}],edges:[{id:'a',source:'input',target:'infer',port:'next'},{id:'b',source:'infer',target:'return',port:'next'}],layout:{},limits:{maxExecutions:1000,maxOutputBytes:1048576}};
    const a=(await action('create',{definition}) as {record:LoopRecord}).record;await action('edit',{id:a.definition.id,expectedRevision:1,changes:{slug:'renamed'},enabled:true});const b=(await action('create',{definition}) as {record:LoopRecord}).record;
    for(const shutdown of shutdowns.splice(0))await shutdown();
    const file=join(s.root,'loops-poc','loops.sqlite'),database=new DatabaseSync(file);
    try{database.prepare("UPDATE loops SET record=json_set(record,'$.enabledRevision',1,'$.publishedRevision',1) WHERE id=?").run(a.definition.id);}finally{database.close();}
    s=await setup({root:s.root});const beforeA=await action('load',{id:a.definition.id}),beforeB=await action('load',{id:b.definition.id});
    expect(await action('run',{slug:'occupied',input:{},requestId:'ui'})).toMatchObject({kind:'loops-error',error:{code:'LOOPS_AMBIGUOUS_SLUG'}});
    const command=(await s.commands.get('loops')!.handler({...s.commandContext,args:'run {"slug":"occupied","requestId":"command"}'})).text;expect(command).toContain('LOOPS_AMBIGUOUS_SLUG');
    expect(await toolJson(s,'run',{slug:'occupied',requestId:'tool'})).toMatchObject({kind:'loops-error',error:{code:'LOOPS_AMBIGUOUS_SLUG'}});expect(s.complete).not.toHaveBeenCalled();expect(await action('runs')).toEqual([]);expect(await action('load',{id:a.definition.id})).toEqual(beforeA);expect(await action('load',{id:b.definition.id})).toEqual(beforeB);
    await action('enable',{id:a.definition.id,revision:2,enabled:false});const run=await toolJson(s,'run',{slug:'occupied',requestId:'tool'});expect(run).toMatchObject({state:'completed',definition:{id:b.definition.id}});expect(s.complete).toHaveBeenCalledOnce();
  });
  it.each(['ui','command','tool'] as const)('deduplicates equivalent nested Unicode object payloads through %s without conflating distinct keys',async surface=>{
    const s=await setup();Object.assign(s.config,{agents:{defaults:{model:{primary:'fake/test-only'}}}});let call=0;
    const invoke=async(input:Record<string,unknown>)=>{
      if(surface==='ui'){const response=await s.action('run',input);if(!response?.ok)throw Error('Feature request failed.');return response.result;}
      if(surface==='tool')return toolJson(s,'run',input,`unicode-${++call}`);
      const text=(await s.commands.get('loops')!.handler({...s.commandContext,args:'run --json-base64 '+Buffer.from(JSON.stringify(input)).toString('base64')})).text!;
      return text.startsWith('Loops [')?{kind:'loops-error',display:text}:JSON.parse(text);
    };
    const definition={slug:`unicode-identity-${surface}`,name:'Unicode identity',description:'Equivalent JSON objects preserve admission identity.',inputSchema:[{name:'data',label:'Data',type:'json',required:true}],capabilities:['llm'],nodes:[{id:'input',kind:'input',label:'Input'},{id:'infer',kind:'inference',label:'Inference',prompt:'Read this JSON: {{input.data}}',output:'text'},{id:'return',kind:'return',label:'Return',value:'{{nodes.infer.text}}'}],edges:[{id:'a',source:'input',target:'infer',port:'next'},{id:'b',source:'infer',target:'return',port:'next'}],layout:{},limits:{maxExecutions:1000,maxOutputBytes:1048576}};
    expect(await s.action('create',{definition})).toMatchObject({ok:true,result:{record:{enabledRevision:1}}});
    const first=await invoke({slug:definition.slug,input:{data:[{'é':0,'e\u0301':false}]},requestId:'unicode-order'});
    expect(first).toMatchObject({state:'completed'});
    const second=await invoke({requestId:'unicode-order',input:{data:[{'e\u0301':false,'é':0}]},slug:definition.slug});
    expect(second).toMatchObject({id:first.id,state:'completed'});expect(s.complete).toHaveBeenCalledOnce();
    const changed=await invoke({slug:definition.slug,input:{data:[{'é':false,'e\u0301':0}]},requestId:'unicode-order'});
    expect(changed).toMatchObject({kind:'loops-error'});expect(s.complete).toHaveBeenCalledOnce();
  });
  it.each(['ui','command','tool'] as const)('retains revoked parked grants through %s reactivation and SQLite restart while allowing explicit new admissions',async surface=>{
    let s=await setup();let sequence=0;
    const invoke=async(op:string,input:Record<string,unknown>={})=>{
      if(surface==='tool')return toolJson(s,op==='load'?'read':op,input,`grants-${++sequence}`);
      if(surface==='command')return commandJson(s,op,input);
      const response=await s.action(op,input);if(!response?.ok)throw Error(JSON.stringify(response));return response.result;
    };
    const failure=async(op:string,input:Record<string,unknown>)=>{
      if(surface==='command')return (await s.commands.get('loops')!.handler({...s.commandContext,args:`${op} ${JSON.stringify(input)}`})).text;
      return invoke(op,input).then(value=>JSON.stringify(value),error=>String(error));
    };
    const {id:_id,revision:_revision,schemaVersion:_version,...content}=structuredClone(examples[0]);
    const definition={...content,slug:`grant-adapter-${surface}`,inputSchema:[],capabilities:['model-info'],nodes:[{id:'input',kind:'input',label:'Input'},{id:'wait',kind:'wait',label:'Wait',message:'Hold before host dispatch'},{id:'model',kind:'action',label:'Model',capability:'model-info'},{id:'return',kind:'return',label:'Return',value:'{{nodes.model.model}}'}],edges:[{id:'a',source:'input',target:'wait',port:'next'},{id:'b',source:'wait',target:'model',port:'next'},{id:'c',source:'model',target:'return',port:'next'}],layout:{}};
    const created=await invoke('create',{definition}),id=created.record.definition.id;
    const parked=await invoke('run',{slug:definition.slug,input:{},requestId:'parked'});expect(parked.state).toBe('waiting');
    const original=await invoke('inspect',{runId:parked.id});expect(original.grantGeneration).toBe(created.record.grantGeneration);
    const revoked=await invoke('revoke',{id});expect(revoked.grantGeneration).not.toBe(created.record.grantGeneration);
    await invoke('enable',{id,revision:1,enabled:true});
    for(const shutdown of shutdowns.splice(0))await shutdown();s=await setup({root:s.root});
    expect(await failure('resume',{runId:parked.id})).toContain('LOOPS_RUN_REVOKED');expect(await invoke('inspect',{runId:parked.id})).toEqual(original);
    const current=await invoke('load',{id});expect(current.grantGeneration).toBe(revoked.grantGeneration);
    const fresh=await invoke('run',{slug:definition.slug,input:{},requestId:'fresh'});expect((await invoke('resume',{runId:fresh.id})).state).toBe('completed');
    await invoke('cancel',{runId:parked.id});
    const recovery=await invoke('retry',{runId:parked.id,mode:'restart',requestId:'explicit-recovery'});expect(recovery.parentRunId).toBe(parked.id);
    const recovered=await invoke('inspect',{runId:recovery.id});expect(recovered.grantGeneration).toBe(current.grantGeneration);expect(recovered.grantGeneration).not.toBe(original.grantGeneration);
    expect((await invoke('resume',{runId:recovery.id})).state).toBe('completed');expect((await invoke('inspect',{runId:parked.id})).grantGeneration).toBe(original.grantGeneration);
    expect(await failure('edit',{id,expectedRevision:1,changes:{grantGeneration:original.grantGeneration}})).toMatch(/schema/i);
    expect((await invoke('load',{id})).grantGeneration).toBe(current.grantGeneration);expect(s.complete).not.toHaveBeenCalled();
  });
  it('shows safe failed-inference location and recovery in legacy commands, UI inspection and actual agent receipts',async()=>{
    const s=await setup(),secret='SYNTHETIC_PRIVATE_DIAGNOSTIC',nodeId=examples[0].nodes.find(node=>node.kind==='inference')!.id;
    Object.assign(s.config,{agents:{defaults:{model:{primary:'fake/test-only'}}}});
    await s.action('enable',{id:'summarize-text',revision:1,enabled:true});
    s.complete.mockRejectedValueOnce(Object.assign(new Error(`Request https://user:${secret}@example.test/private and /private/${secret}/request.json with body ${secret}`),{status:401}));
    const command=await s.commands.get('loops')!.handler({...s.commandContext,args:'run summarize-text Synthetic source'}),history=await s.action('runs',{});
    if(!history?.ok)throw Error('Run history was unavailable.');
    const runId=(history.result as Array<{id:string}>)[0].id,inspection=await s.action('inspect',{runId}),tool=await toolJson(s,'status',{runId});
    expect(inspection).toMatchObject({result:{state:'failed',errorDetail:{code:'HOST_AUTHENTICATION_FAILED',phase:'inference',nodeId,model:'fake/test-only',retryable:false,recovery:expect.any(String)}}});
    expect(tool).toMatchObject({state:'failed',errorDetail:{code:'HOST_AUTHENTICATION_FAILED',phase:'inference',nodeId,model:'fake/test-only',retryable:false}});
    for(const value of ['HOST_AUTHENTICATION_FAILED','Phase: inference','Node: '+nodeId,'Model: fake/test-only','Retryable: Resolve the failure first','Next step:'])expect(command.text).toContain(value);
    expect(JSON.stringify([command,inspection,tool])).not.toContain(secret);expect(JSON.stringify([command,inspection,tool])).not.toContain('example.test');expect(JSON.stringify([command,inspection,tool])).not.toContain('/private/');
    expect(command.text).not.toContain(' · completed');expect(s.complete).toHaveBeenCalledOnce();
  });
  it('keeps handler-level validation diagnostics visible and renders the shared client error without executing a failed request',async()=>{
    const s=await setup(),command=await s.commands.get('loops')!.handler({...s.commandContext,args:'missing-operation'});
    expect(command.text).toContain('Phase: operation');expect(command.text).toContain('Retryable: Resolve the failure first');expect(command.text).toContain('Next step:');
    const transport={pluginId:'loops-poc',signal:new AbortController().signal,connection:{connected:true},onEvent:()=>()=>{},subscribe:()=>()=>{},request:async(_method:string,params:Record<string,unknown>)=>s.action(params.actionId as string,params.payload as Record<string,unknown>)} as FeatureTransport;
    const client=createLoopsClient(transport),failure=await client.invoke('run',{slug:'summarize-text',input:{text:'Not submitted'},requestId:'disabled'}).then(()=>{throw Error('Disabled run unexpectedly succeeded');},error=>error);
    const presented=displayFailure(failure),html=renderToStaticMarkup(React.createElement(FailureNotice,{failure:presented}));
    expect(presented).toMatchObject({code:'LOOPS_INVALID_REQUEST',phase:'operation',retryable:false,recovery:expect.any(String)});
    expect(html).toContain('LOOPS_INVALID_REQUEST');expect(html).toContain('<dd>operation</dd>');expect(html).toContain('Next step:');expect(await s.action('runs',{})).toMatchObject({result:[]});expect(s.complete).not.toHaveBeenCalled();
  });
  it.each(['ui','command','tool'] as const)('qualifies every lifecycle operation and common negative boundaries through %s',async surface=>{
    const s=await setup();
    Object.assign(s.config,{agents:{defaults:{model:{primary:'fake/test-only'}}}});
    type Operation=keyof typeof wireContract.operations;
    const inputs=new Map<Operation,Record<string,unknown>>();let sequence=0;
    const raw=async(op:Operation,input:Record<string,unknown>):Promise<unknown>=>{
      if(surface==='command')return (await s.commands.get('loops')!.handler({...s.commandContext,args:`${op} --json-base64 ${Buffer.from(JSON.stringify(input)).toString('base64')}`})).text;
      if(surface==='tool'){
        const operation=wireContract.operations[op];if(!('tool' in operation))throw new Error('No agent tool for '+op);
        return (await s.tools.find(t=>t.name===operation.tool.name)!.execute(`inventory-${++sequence}`,input)).details;
      }
      const response=await s.action(op,input);if(!response?.ok)throw new Error(JSON.stringify(response));return response.result;
    };
    const invoke=async(op:Operation,input:Record<string,unknown>={}):Promise<unknown>=>{
      inputs.set(op,input);
      const response=await raw(op,input);
      if(surface==='command'&&(response as string).startsWith('Loops ['))return {kind:'loops-error',display:response};
      const value=surface==='command'?JSON.parse((response as string).split('\n\nRead the full JSON result with ')[0]):response;
      if(!Value.Check(DocumentReferenceSchema,value))return value;
      let text='',offset=0;
      while(true){const page=await invoke('document',{documentId:value.documentId,offset}) as {text:string;sha256:string;offset:number;nextOffset:number|null};expect(page.sha256).toBe(value.sha256);expect(page.offset).toBe(offset);text+=page.text;if(page.nextOffset===null)break;expect(page.nextOffset).toBeGreaterThan(offset);offset=page.nextOffset;}
      expect(Buffer.byteLength(text)).toBe(value.bytes);expect(createHash('sha256').update(text).digest('hex')).toBe(value.sha256);return JSON.parse(text);
    };
    const {id:_id,revision:_revision,schemaVersion:_version,...content}=structuredClone(examples[0]);
    content.slug=`inventory-${surface}`;content.capabilities=[];content.limits.maxOutputBytes=1024*1024;
    content.nodes=[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'{{input.text}}'}];content.edges=[{id:'next',source:'input',target:'return',port:'next'}];
    const created=await invoke('create',{definition:content}) as {record:LoopRecord},id=created.record.definition.id;
    expect(created.record.enabledRevision).toBe(1);
    expect(await invoke('load',{id})).toEqual(created.record);
    expect(await invoke('library')).toEqual(expect.arrayContaining([expect.objectContaining({id})]));
    expect(await invoke('browse',{search:content.slug,limit:1})).toMatchObject({total:1,nextCursor:null,items:[{id}]});
    expect(await invoke('list')).toEqual(expect.arrayContaining([expect.objectContaining({id})]));
    expect(await invoke('capabilities')).toMatchObject({model:'fake/test-only',parameters:expect.any(Array),concurrency:1});
    expect(await invoke('validate',{definition:created.record.definition})).toEqual({valid:true,issues:[]});
    const saved=await invoke('save',{definition:{...created.record.definition,name:'Full save'},expectedRevision:1,enabled:true}) as {record:LoopRecord};
    expect(saved.record).toMatchObject({enabledRevision:2,definition:{revision:2,name:'Full save'}});
    const draft=await invoke('draft',{definition:{...saved.record.definition,name:'Unpublished draft'},expectedRevision:2}) as {record:LoopRecord};
    expect(draft.record).toMatchObject({enabledRevision:2,publishedRevision:2,definition:{revision:3}});
    expect(await invoke('edit',{id,expectedRevision:3,changes:{description:'Edited'}})).toMatchObject({record:{enabledRevision:4,definition:{revision:4}}});
    expect(await invoke('versions',{id})).toMatchObject([{revision:4},{revision:3},{revision:2},{revision:1}]);
    const restored=await invoke('restore',{id,revision:2,expectedRevision:4}) as {record:LoopRecord};
    expect(restored.record).toMatchObject({enabledRevision:4,definition:{revision:5,name:'Full save'}});
    expect(await invoke('publish',{id,revision:5,expectedRevision:5})).toMatchObject({enabledRevision:5,publishedRevision:5});
    expect(await invoke('describe',{slug:content.slug})).toMatchObject({id,revision:5,name:'Full save'});
    expect(await invoke('enable',{id,revision:5,enabled:false})).toMatchObject({enabledRevision:null});
    expect(await invoke('run',{slug:content.slug,input:{text:'Disabled'},requestId:'disabled'})).toMatchObject({kind:'loops-error'});
    await invoke('enable',{id,revision:5,enabled:true});
    const first=await invoke('run',{slug:content.slug,input:{text:'Complete result'},requestId:'first'}) as RunReceipt;
    expect(first).toMatchObject({state:'completed',source:surface==='ui'?'session-action':surface,result:'Complete result',definition:{revision:5}});
    expect(await invoke('status',{runId:first.id})).toEqual(first);
    expect(await invoke('runs')).toEqual(expect.arrayContaining([expect.objectContaining({id:first.id,state:'completed'})]));
    expect(await invoke('history',{limit:1})).toMatchObject({total:1,nextCursor:null,items:[{id:first.id}]});
    expect(await invoke('inspect',{runId:first.id})).toMatchObject({result:'Complete result',definition:{revision:5},input:{text:'Complete result'}});
    expect(await invoke('output',{runId:first.id})).toMatchObject({text:'Complete result',nextOffset:null});
    // Exceed the actual feature string envelope, stage bounded UTF-8 JSON and
    // reconstruct the returned immutable document on every surface.
    const large='x'.repeat(66000)+'🙂END',json=JSON.stringify({text:large}),characters=Array.from(json),sha256=createHash('sha256').update(json).digest('hex');
    let reference:unknown;
    for(let offset=0;offset<characters.length;offset+=1000){const page=await invoke('upload',{uploadId:'inventory-upload',offset,text:characters.slice(offset,offset+1000).join(''),complete:offset+1000>=characters.length,sha256}) as {reference?:unknown};reference=page.reference;}
    const big=await invoke('run',{slug:content.slug,input:reference,requestId:'large'}) as RunReceipt;
    expect(big).toMatchObject({state:'completed',resultTruncated:true});
    expect(await invoke('inspect',{runId:big.id})).toMatchObject({result:large});
    const definition={...restored.record.definition,nodes:[content.nodes[0],{id:'wait',kind:'wait',label:'Wait',message:'Continue explicitly'},content.nodes[1]],edges:[{id:'a',source:'input',target:'wait',port:'next'},{id:'b',source:'wait',target:'return',port:'next'}]};
    const wait=await invoke('test',{definition,input:{text:'Wait result'},requestId:'wait'}) as RunReceipt;
    expect(wait).toMatchObject({state:'waiting',testMode:true});expect(await invoke('resume',{runId:wait.id})).toMatchObject({state:'completed',result:'Wait result'});
    const cancelled=await invoke('test',{definition,input:{text:'Cancelled result'},requestId:'cancel'}) as RunReceipt;
    expect(await invoke('cancel',{runId:cancelled.id})).toMatchObject({state:'cancelled'});
    const retry=await invoke('retry',{runId:cancelled.id,mode:'restart',requestId:'restart'}) as RunReceipt;
    expect(retry).toMatchObject({state:'waiting',parentRunId:cancelled.id});await invoke('cancel',{runId:retry.id});
    const reviewDefinition={...definition,nodes:[content.nodes[0],{id:'review',kind:'review',label:'Review',proposal:'Authored human decision'},content.nodes[1],{id:'fail',kind:'fail',label:'Fail',reason:'Rejected'}],edges:[{id:'a',source:'input',target:'review',port:'next'},{id:'b',source:'review',target:'return',port:'approve'},{id:'c',source:'review',target:'fail',port:'reject'}]};
    const review=await invoke('test',{definition:reviewDefinition,input:{text:'Approved'},requestId:'review'}) as RunReceipt;
    expect(review.state).toBe('review');expect(await invoke('resume',{runId:review.id})).toMatchObject({kind:'loops-error'});
    expect(await s.action('review',{runId:review.id,decision:'approve'},['operator.write'])).toMatchObject({result:{kind:'loops-error'}});
    if(surface==='tool'){
      expect(s.tools.some(t=>t.name==='loops_review')).toBe(false);
      // A separate authenticated human action, never attributed to the agent.
      expect(await s.action('review',{runId:review.id,decision:'approve'})).toMatchObject({result:{state:'completed',result:'Approved'}});
    }else expect(await invoke('review',{runId:review.id,decision:'approve'})).toMatchObject({state:'completed',result:'Approved'});
    expect(await invoke('revoke',{id})).toMatchObject({enabledRevision:null,revoked:true});
    expect(await invoke('run',{slug:content.slug,input:{text:'Revoked'},requestId:'revoked'})).toMatchObject({kind:'loops-error'});
    expect(await invoke('archive',{id,expectedRevision:5,archived:true})).toMatchObject({archived:true});
    expect(await invoke('deleted')).toEqual(expect.arrayContaining([expect.objectContaining({id,archived:true})]));
    expect(await invoke('recover',{id,expectedRevision:5})).toMatchObject({archived:false,enabledRevision:null});
    expect(await invoke('delete',{id,expectedRevision:5})).toMatchObject({id,deleted:true});
    const policy={keepLatest:1000},plan=await invoke('retention',{policy}) as {planId:string};
    expect(await invoke('retention',{policy,applyPlanId:plan.planId})).toMatchObject({applied:true,candidates:[]});
    expect([...inputs.keys()].sort()).toEqual(Object.keys(wireContract.operations).filter(op=>surface!=='tool'||op!=='review').sort());
    const before=await s.action('history',{});
    // Every operation rejects caller-identity injection before dispatch. This
    // uses each actual valid request, not synthetic schema-only assertions.
    for(const [op,input] of inputs){const denied=await raw(op,{...input,sessionId:'forged'}).then(value=>JSON.stringify(value),error=>String(error));expect(denied,`${surface}/${op} schema`).toMatch(/schema/i);}
    expect(await s.action('history',{})).toEqual(before);
    s.config.plugins.entries['loops-poc'].enabled=false;
    for(const [op,input] of inputs){const denied=await raw(op,input).then(value=>JSON.stringify(value),error=>String(error));expect(denied,`${surface}/${op} revoked host policy`).toMatch(/disabled/i);}
    s.config.plugins.entries['loops-poc'].enabled=true;
    for(const service of s.services)await service.stop?.({} as Parameters<OpenClawPluginService['start']>[0]);
    for(const [op,input] of inputs){const unavailable=await raw(op,input).then(value=>JSON.stringify(value),error=>String(error));expect(unavailable,`${surface}/${op} stopped service`).toMatch(/LOOPS_SERVICE_UNAVAILABLE/);}
    expect(s.complete).not.toHaveBeenCalled();
  },30_000);
  it('lets agents save full definitions with the same activation and conflict semantics as the editor',async()=>{
    const s=await setup(),save=s.tools.find(t=>t.name==='loops_save');
    expect(save,'Every non-human-only operation must have an agent tool').toBeDefined();
    const definition={...structuredClone(examples[1]),id:'agent-full-save',slug:'agent-full-save',revision:0};
    const inspect=(value:unknown)=>{if(!value||typeof value!=='object')return;const schema=value as Record<string,unknown>;if(schema.type==='array')expect(Array.isArray(schema.items)).toBe(false);for(const child of Object.values(schema))inspect(child);};inspect(save!.parameters);
    const saved=await toolJson(s,'save',{definition,expectedRevision:0,enabled:true});
    expect(saved).toMatchObject({issues:[],record:{enabledRevision:1,definition:{revision:1}}});
    const loaded=await s.action('load',{id:definition.id});if(!loaded?.ok)throw new Error('Saved definition was not readable');
    const current=loaded.result as {definition:typeof definition};
    expect(await toolJson(s,'save',{definition:{...current.definition,name:'Full replacement'},expectedRevision:1})).toMatchObject({record:{enabledRevision:null,definition:{revision:2,name:'Full replacement'}}});
    expect(await toolJson(s,'save',{definition:current.definition,expectedRevision:1,enabled:true})).toMatchObject({kind:'loops-error',error:{code:'LOOPS_REVISION_CONFLICT'}});
    for(const injection of [{grants:['llm']},{human:true},{sessionId:'forged'}])await expect(save!.execute('forged-save',{definition:current.definition,expectedRevision:2,...injection})).rejects.toThrow(/schema/);
    expect(await commandJson(s,'read',{id:definition.id})).toMatchObject({enabledRevision:null,definition:{revision:2,name:'Full replacement'}});
    expect(s.complete).not.toHaveBeenCalled();
  });
  it('shares explicit JSON values and unfinished drafts through agent tools, conversation commands and the editor SDK',async()=>{
    const s=await setup();
    const command=(op:string,input:unknown={})=>commandJson(s,op,input);
    const tool=(name:string,input:Record<string,unknown>)=>toolJson(s,name,input,`json-${name}`);
    const transport={pluginId:'loops-poc',signal:new AbortController().signal,connection:{connected:true},onEvent:()=>()=>{},subscribe:()=>()=>{},request:async(_method:string,params:Record<string,unknown>)=>s.action(params.actionId as string,params.payload as Record<string,unknown>)} as FeatureTransport;
    const client=createLoopsClient(transport),{id:_id,revision:_revision,schemaVersion:_version,...content}=structuredClone(examples[0]);
    content.slug='typed-sdk';content.inputSchema=[];content.capabilities=[];content.limits.maxOutputBytes=100000;
    content.nodes=[{id:'input',kind:'input',label:'Input'},{id:'condition',kind:'condition',label:'Numeric constant',predicate:{left:{literalJson:'0'},op:'less-than',right:{literalJson:'2'}}},{id:'return',kind:'return',label:'Return',value:{literalJson:'{"count":0,"ready":false,"text":"{{input.absent}}"}'}},{id:'fail',kind:'fail',label:'Fail',reason:'Wrong branch'}];
    content.edges=[{id:'entry',source:'input',target:'condition',port:'next'},{id:'yes',source:'condition',target:'return',port:'true'},{id:'no',source:'condition',target:'fail',port:'false'}];
    const created=await tool('create',{definition:content}),record=(created as unknown as Awaited<ReturnType<typeof client.invoke<'create'>>>).record,id=record.definition.id;
    expect(record).toMatchObject({enabledRevision:1,definition:{schemaVersion:2}});
    const result={count:0,ready:false,text:'{{input.absent}}'};
    expect(await command('run',{slug:content.slug,requestId:'command-json'})).toMatchObject({state:'completed',result,source:'command'});
    expect(await tool('run',{slug:content.slug,requestId:'tool-json'})).toMatchObject({state:'completed',result,source:'tool'});
    const draft=structuredClone(record.definition);if(draft.nodes[2].kind!=='return')throw Error();draft.nodes[2].value={literalJson:'{"unfinished":'};
    const saved=await command('draft',{definition:draft,expectedRevision:1});expect(saved).toMatchObject({record:{enabledRevision:1,definition:{revision:2,nodes:draft.nodes}},issues:[{nodeId:'return'}]});
    await expect(client.invoke('publish',{id,revision:2,expectedRevision:2})).rejects.toThrow('Literal JSON');
    await expect(client.invoke('test',{definition:draft,input:{},requestId:'invalid-json'})).rejects.toThrow('Literal JSON');
    expect(await client.invoke('run',{slug:content.slug,requestId:'published-unaffected'})).toMatchObject({state:'completed',result});
    const repaired=structuredClone(draft.nodes);if(repaired[2].kind!=='return')throw Error();repaired[2].value={literalJson:'[0,false,null]'};
    expect(await tool('edit',{id,expectedRevision:2,changes:{nodes:repaired}})).toMatchObject({record:{enabledRevision:3,definition:{nodes:repaired}}});
    expect(await client.invoke('run',{slug:content.slug,requestId:'editor-json'})).toMatchObject({state:'completed',result:[0,false,null],source:'session-action'});
    const restored=await command('restore',{id,revision:2,expectedRevision:3});expect(restored).toMatchObject({record:{enabledRevision:3,definition:{revision:4,nodes:draft.nodes}}});
    const test=await tool('test',{definition:{...record.definition,nodes:repaired},input:{},requestId:'unpublished-json'});expect(test).toMatchObject({state:'completed',result:[0,false,null]});
    // Actual registered public tool schemas reject v1 literals before dispatch.
    for(const operation of ['draft','test','validate']){
      const schema=s.tools.find(t=>t.name===`loops_${operation}`)!.parameters;
      const args={definition:record.definition,...operation==='draft'?{expectedRevision:1}:operation==='test'?{input:{},requestId:'schema-only'}:{}};
      expect(Value.Check(schema,args),operation).toBe(true);expect(Value.Check(schema,{...args,definition:{...record.definition,schemaVersion:1}}),operation).toBe(false);
    }
    await expect(client.invoke('test',{definition:{...record.definition,schemaVersion:1},input:{},requestId:'invalid-version'})).rejects.toThrow();
    const versions=await client.invoke('versions',{id});expect(versions.map(v=>v.revision)).toEqual([4,3,2,1]);
    for(const service of s.services)await service.stop?.({} as Parameters<OpenClawPluginService['start']>[0]);
    const reopened=await setup({root:s.root});const read=await toolJson(reopened,'read',{id},'read-json');
    expect(read).toMatchObject({enabledRevision:3,definition:{revision:4,nodes:draft.nodes}});
    expect(s.complete).not.toHaveBeenCalled();expect(reopened.complete).not.toHaveBeenCalled();
  });
  it('rejects transport before service startup without creating files through any adapter',async()=>{
    const s=await setup({start:false}),input={uploadId:'not-started',offset:0,text:'{}'};
    expect((await s.commands.get('loops')!.handler({...s.commandContext,args:'help'})).text).toContain('Operations:');
    expect(await s.action('upload',input)).toMatchObject({result:{kind:'loops-error',error:{code:'LOOPS_SERVICE_UNAVAILABLE'}}});
    expect((await s.tools.find(tool=>tool.name==='loops_upload')!.execute('not-started',input)).details).toMatchObject({kind:'loops-error',error:{code:'LOOPS_SERVICE_UNAVAILABLE'}});
    expect((await s.commands.get('loops')!.handler({...s.commandContext,args:`upload ${JSON.stringify(input)}`})).text).toContain('LOOPS_SERVICE_UNAVAILABLE');
    expect(existsSync(join(s.root,'loops-poc'))).toBe(false);
  });
  it('restores a matched application, database and document snapshot without changing the backup',async()=>{
    mkdirSync('.dev-profile',{recursive:true});const root=mkdtempSync(resolve('.dev-profile/backup-qualification-'));directories.push(root);
    const original=await setup({root:join(root,'original')}),backup=join(root,'backup'),restoration=join(root,'restoration');
    const appRoot=process.env.LOOPS_TEST_PLUGIN?dirname(dirname(fileURLToPath(process.env.LOOPS_TEST_PLUGIN))):resolve('.');
    const context={} as Parameters<OpenClawPluginService['start']>[0];
    const stop=async(s:Awaited<ReturnType<typeof setup>>)=>{for(const service of s.services)await service.stop?.(context);};
    const transportFor=(s:Awaited<ReturnType<typeof setup>>)=>({pluginId:'loops-poc',signal:new AbortController().signal,connection:{connected:true},onEvent:()=>()=>{},subscribe:()=>()=>{},request:async(_method:string,params:Record<string,unknown>)=>s.action(params.actionId as string,params.payload as Record<string,unknown>)} as FeatureTransport);
    const clientFor=(s:Awaited<ReturnType<typeof setup>>)=>createLoopsClient(transportFor(s));
    const wireFor=(s:Awaited<ReturnType<typeof setup>>)=>createFeatureClient(wireContract,transportFor(s));
    const client=clientFor(original),large='Complete 🙂 backup evidence. '.repeat(3500);expect(fitsFeatureJson({text:large})).toBe(false);
    const {id:_id,revision:_revision,schemaVersion:_version,...definition}=structuredClone(examples[0]);
    definition.slug='backup-completed';definition.capabilities=[];definition.limits.maxOutputBytes=1024*1024;
    definition.nodes=[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'{{input.text}}'}];definition.edges=[{id:'next',source:'input',target:'return',port:'next'}];
    const completedDefinition=await client.invoke('create',{definition});
    const completed=await client.invoke('run',{slug:definition.slug,input:{text:large},requestId:'backup-completed'});expect(completed.state).toBe('completed');
    const document=await wireFor(original).invoke('inspect',{runId:completed.id}) as {kind:string;documentId:string;sha256:string};expect(document.kind).toBe('loops-document');
    const parkedDefinition=await client.invoke('create',{definition:{...definition,slug:'backup-waiting',nodes:[definition.nodes[0],{id:'wait',kind:'wait',label:'Wait',message:'Durable backup checkpoint'},definition.nodes[1]],edges:[{id:'a',source:'input',target:'wait',port:'next'},{id:'b',source:'wait',target:'return',port:'next'}]}});
    const parked=await client.invoke('run',{slug:'backup-waiting',input:{text:'Pinned backup result'},requestId:'backup-parked'});expect(parked.state).toBe('waiting');
    await client.invoke('edit',{id:parkedDefinition.record.definition.id,expectedRevision:1,changes:{name:'Revision 2 after parked admission'}});
    const staged=JSON.stringify({text:'Resume this staged request after rollback'}),cut=20;
    await wireFor(original).invoke('upload',{uploadId:'backup-partial',offset:0,text:staged.slice(0,cut)});
    const expectedLibrary=await client.invoke('library',{}),expectedHistory=await client.invoke('history',{}),expectedRun=await client.invoke('inspect',{runId:completed.id}),expectedVersions=await client.invoke('versions',{id:parkedDefinition.record.definition.id});
    expect(expectedLibrary).toHaveLength(5);expect(expectedHistory.total).toBe(2);await stop(original);
    mkdirSync(join(backup,'app'),{recursive:true});
    for(const name of ['dist','package.json','openclaw.plugin.json'])cpSync(join(appRoot,name),join(backup,'app',name),{recursive:true});
    cpSync(join(original.root,'loops-poc'),join(backup,'profile','loops-poc'),{recursive:true});
    const hashes=(directory:string,prefix=''):Record<string,string>=>Object.fromEntries(readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>entry.isDirectory()?Object.entries(hashes(join(directory,entry.name),prefix+entry.name+'/')):[[prefix+entry.name,createHash('sha256').update(readFileSync(join(directory,entry.name))).digest('hex')]]));
    const backupHashes=hashes(backup);expect(Object.keys(backupHashes).some(name=>name.startsWith('profile/loops-poc/documents/document-'))).toBe(true);expect(Object.keys(backupHashes).some(name=>name.startsWith('profile/loops-poc/documents/upload-'))).toBe(true);
    // A newer working profile can diverge without modifying its stopped backup.
    const newer=await setup({root:original.root});await clientFor(newer).invoke('edit',{id:completedDefinition.record.definition.id,expectedRevision:1,changes:{name:'Later work outside the backup'}});await stop(newer);
    cpSync(backup,restoration,{recursive:true});expect(hashes(restoration)).toEqual(backupHashes);
    if(process.env.LOOPS_TEST_PLUGIN){const manifest=JSON.parse(readFileSync(join(restoration,'app/openclaw.plugin.json'),'utf8'));expect(existsSync(join(restoration,'app',manifest.controlUi.entry))).toBe(true);}
    const restoredPlugin=(await import(/* @vite-ignore */ pathToFileURL(join(restoration,'app/dist/index.js')).href)).default as typeof sourcePlugin;
    const restored=await setup({root:join(restoration,'profile'),plugin:restoredPlugin}),read=clientFor(restored);
    expect(await read.invoke('library',{})).toEqual(expectedLibrary);expect(await read.invoke('history',{})).toEqual(expectedHistory);
    expect(await read.invoke('inspect',{runId:completed.id})).toEqual(expectedRun);expect(await read.invoke('versions',{id:parkedDefinition.record.definition.id})).toEqual(expectedVersions);
    let text='',offset=0;while(true){const page=await wireFor(restored).invoke('document',{documentId:document.documentId,offset,limit:16000});if('kind' in page)throw new Error(page.error.message);text+=page.text;if(page.nextOffset===null)break;offset=page.nextOffset;}
    expect(createHash('sha256').update(text).digest('hex')).toBe(document.sha256);expect(JSON.parse(text)).toEqual(expectedRun);expect(expectedRun.result).toBe(large);
    expect(await read.invoke('resume',{runId:parked.id})).toMatchObject({state:'completed',definition:{revision:1},result:'Pinned backup result'});
    const upload=await wireFor(restored).invoke('upload',{uploadId:'backup-partial',offset:cut,text:staged.slice(cut),complete:true,sha256:createHash('sha256').update(staged).digest('hex')});if('kind' in upload)throw new Error(upload.error.message);expect(upload.completed).toBe(true);
    expect(await read.invoke('run',{slug:definition.slug,input:upload.reference!,requestId:'restored-staging'})).toMatchObject({state:'completed',result:'Resume this staged request after rollback'});
    await stop(restored);expect(hashes(backup)).toEqual(backupHashes);
    const db=new DatabaseSync(join(restoration,'profile/loops-poc/loops.sqlite'),{readOnly:true});
    try{expect(db.prepare('PRAGMA integrity_check').all()).toEqual([{integrity_check:'ok'}]);expect(db.prepare('SELECT count(*) AS n FROM loops').get()).toEqual({n:5});expect(db.prepare('SELECT count(*) AS n FROM runs').get()).toEqual({n:3});}finally{db.close();}
    expect(original.complete).not.toHaveBeenCalled();expect(restored.complete).not.toHaveBeenCalled();
  },30_000);
  it('shares searchable library pages and stale-cursor diagnostics across commands, tools and UI',async()=>{
    const s=await setup(),handler=s.commands.get('loops')!.handler;
    const command=(op:string,input:unknown={})=>commandJson(s,op,input);
    const transport={pluginId:'loops-poc',signal:new AbortController().signal,connection:{connected:true},onEvent:()=>()=>{},subscribe:()=>()=>{},request:async(_method:string,params:Record<string,unknown>)=>s.action(params.actionId as string,params.payload as Record<string,unknown>)} as FeatureTransport;
    const client=createLoopsClient(transport),tool=s.tools.find(t=>t.name==='loops_browse')!;
    const {id:_id,revision:_revision,schemaVersion:_version,...definition}=structuredClone(examples[0]);
    for(let i=0;i<25;i++)await command('create',{definition:{...definition,slug:`paged-adapter-${i}`,name:`Paged ${i}`},enabled:false});
    const query={search:'paged-adapter-',limit:4},first=await command('browse',query);
    expect(first).toMatchObject({total:25,offset:0,nextCursor:expect.any(String)});expect(first.items).toHaveLength(4);
    expect(await client.invoke('browse',query)).toEqual(first);expect((await tool.execute('library-page',query)).details).toEqual(first);
    const ids:string[]=first.items.map((item:{id:string})=>item.id);let cursor:string|null=first.nextCursor;
    while(cursor){const page=await client.invoke('browse',{...query,cursor});ids.push(...page.items.map(item=>item.id));cursor=page.nextCursor;}
    expect(ids).toHaveLength(25);expect(new Set(ids).size).toBe(25);
    await command('archive',{id:first.items[0].id,expectedRevision:1,archived:true});
    await expect(client.invoke('browse',{...query,cursor:first.nextCursor})).rejects.toMatchObject({code:'LOOPS_LIBRARY_CHANGED'});
    expect((await tool.execute('stale-library',{...query,cursor:first.nextCursor})).details).toMatchObject({kind:'loops-error',error:{code:'LOOPS_LIBRARY_CHANGED'}});
    expect((await handler({...s.commandContext,args:`browse ${JSON.stringify({...query,cursor:first.nextCursor})}`})).text).toContain('LOOPS_LIBRARY_CHANGED');
    expect((await client.invoke('browse',{view:'recoverable',search:query.search})).total).toBe(1);
    expect((await command('library')).length).toBe(27);expect(s.complete).not.toHaveBeenCalled();
  });
  it('exposes capability discovery through the real conversation command',async()=>{
    const s=await setup();
    const reply=await s.commands.get('loops')!.handler({...s.commandContext,args:'capabilities {}'});
    expect(JSON.parse(reply.text!)).toMatchObject({parameters:expect.any(Array),concurrency:1});
  });
  it('authors and versions the same enabled definitions through commands, tools and UI',async()=>{
    const s=await setup(),handler=s.commands.get('loops')!.handler;
    const command=(op:string,input:unknown={})=>commandJson(s,op,input);
    const {id:_id,revision:_revision,schemaVersion:_version,...definition}=structuredClone(examples[0]);
    definition.slug='command-authored';const inference=definition.nodes.find(node=>node.kind==='inference');if(inference?.kind!=='inference')throw Error();inference.advanced={temperature:0,maxTokens:800};
    const created=await command('create',{definition}),id=created.record.definition.id;
    expect(created).toMatchObject({record:{enabledRevision:1,definition:{revision:1,nodes:expect.arrayContaining([expect.objectContaining({advanced:{temperature:0,maxTokens:800}})])}}});
    expect(JSON.parse((await handler({...s.commandContext,args:`read ${id}`})).text!)).toEqual(created.record);
    expect((await s.tools.find(tool=>tool.name==='loops_read')!.execute('command-authored-read',{id})).details).toEqual(created.record);
    expect(await s.action('load',{id})).toEqual({ok:true,result:created.record});
    const draft=await command('draft',{definition:{...created.record.definition,name:'Command draft'},expectedRevision:1});
    expect(draft.record).toMatchObject({enabledRevision:1,publishedRevision:1,definition:{revision:2,name:'Command draft'}});
    expect(await command('validate',{definition:draft.record.definition})).toMatchObject({issues:[]});
    expect((await command('versions',{id})).map((version:{revision:number})=>version.revision)).toEqual([2,1]);
    expect(await command('publish',{id,revision:2,expectedRevision:2})).toMatchObject({enabledRevision:2,publishedRevision:2});
    expect((await s.tools.find(tool=>tool.name==='loops_describe')!.execute('command-publication',{slug:definition.slug})).details).toMatchObject({revision:2,name:'Command draft'});
    expect(await command('edit',{id,expectedRevision:2,changes:{description:'Explicit command draft'},enabled:false})).toMatchObject({record:{enabledRevision:null,definition:{revision:3}}});
    expect(await command('enable',{id,revision:3,enabled:true})).toMatchObject({enabledRevision:3});
    const restored=await command('restore',{id,revision:1,expectedRevision:3});
    expect(restored.record).toMatchObject({enabledRevision:3,definition:{revision:4,nodes:expect.arrayContaining([expect.objectContaining({advanced:{temperature:0,maxTokens:800}})])}});
    expect(await command('archive',{id,expectedRevision:4,archived:true})).toMatchObject({archived:true,enabledRevision:null});
    expect(await command('deleted')).toEqual([expect.objectContaining({id,archived:true})]);
    expect(await command('recover',{id,expectedRevision:4})).toMatchObject({archived:false,enabledRevision:null});
    expect(await command('delete',{id,expectedRevision:4})).toMatchObject({id,deleted:true});
    expect(await s.action('load',{id})).toMatchObject({result:{kind:'loops-error'}});
    expect(s.complete).not.toHaveBeenCalled();
  });
  it('uses command-bound inference and fresh or explicit retry identities for JSON invocation and recovery',async()=>{
    const s=await setup(),handler=s.commands.get('loops')!.handler,bound=vi.fn(s.complete.getMockImplementation()!);
    const context={...s.commandContext,runtimeContext:{llm:{complete:bound}}};
    const command=async(op:string,input:unknown={})=>JSON.parse((await handler({...context,args:`${op} ${JSON.stringify(input)}`})).text!);
    await command('enable',{id:'summarize-text',revision:1,enabled:true});
    const input={slug:'summarize-text',input:{text:'JSON command inference'}};
    const first=await command('run',input),second=await command('run',input);
    expect(first).toMatchObject({state:'completed',source:'command'});expect(second.id).not.toBe(first.id);
    const intentional=await command('run',{...input,requestId:'one-admission'});
    expect(await command('run',{...input,requestId:'one-admission'})).toEqual(intentional);
    expect(bound).toHaveBeenCalledTimes(3);expect(s.complete).not.toHaveBeenCalled();
    expect(await command('history',{limit:1})).toMatchObject({total:3,nextCursor:1,items:[expect.any(Object)]});
    expect(await command('inspect',{runId:first.id})).toMatchObject({id:first.id,outputs:{summary:{text:'An actual adapter result.'}}});
    expect(await command('output',{runId:first.id})).toMatchObject({text:'An actual adapter result.',nextOffset:null});
    bound.mockRejectedValueOnce(new Error('Synthetic failed provider call'));
    const failed=await command('run',input);expect(failed.state).toBe('failed');
    const retry=await command('retry',{runId:failed.id,mode:'retry-node'});
    expect(retry).toMatchObject({state:'completed',parentRunId:failed.id});
    const definition=(await command('read',{id:'summarize-text'})).definition;
    const tested=await command('test',{definition,input:input.input});
    expect(tested).toMatchObject({state:'completed',testMode:true});expect(bound).toHaveBeenCalledTimes(6);
  });
  it('validates command identity and authority before mutation and retains optimistic conflicts',async()=>{
    const s=await setup(),handler=s.commands.get('loops')!.handler;
    const args=`edit ${JSON.stringify({id:'summarize-text',expectedRevision:1,changes:{name:'Command edit'}})}`;
    expect((await handler({...s.commandContext,isAuthorizedSender:false,args})).text).toContain('Unauthorized');
    expect((await handler({...s.commandContext,gatewayClientScopes:['operator.read'],args})).text).toContain('write access');
    for(const injected of [{agentId:'other'},{sessionId:'forged'},{human:true}]){
      const denied=await handler({...s.commandContext,args:`edit ${JSON.stringify({id:'summarize-text',expectedRevision:1,changes:{name:'Injected'},...injected})}`});
      expect(denied.text).toContain('schema');
    }
    expect((await handler({...s.commandContext,args:'toString {}'})).text).toContain('Unknown Loops operation');
    expect((await handler({...s.commandContext,args:'run summarize-text bad --request-id'})).text).not.toContain('completed');
    expect(await s.action('load',{id:'summarize-text'})).toMatchObject({result:{definition:{revision:1,name:examples[0].name}}});
    await handler({...s.commandContext,args});
    expect((await handler({...s.commandContext,args})).text).toContain('LOOPS_REVISION_CONFLICT');
    expect(await s.action('load',{id:'summarize-text'})).toMatchObject({result:{definition:{revision:2,name:'Command edit'}}});
    expect(s.complete).not.toHaveBeenCalled();
  });
  it('rejects host-truncated commands before admitting an altered input',async()=>{
    const s=await setup(),handler=s.commands.get('loops')!.handler;
    await s.action('enable',{id:'summarize-text',revision:1,enabled:true});
    const args='run summarize-text '+'Important source. '.repeat(400),before=await s.action('runs',{});
    const reply=await handler({...s.commandContext,commandBody:'/loops '+args,args:args.slice(0,4096)});
    expect(reply.text).toContain('HOST_COMMAND_INPUT_CHANGED');expect(reply.text).toContain('upload');
    expect(await s.action('runs',{})).toEqual(before);expect(s.complete).not.toHaveBeenCalled();
  });
  it('retrieves complete command results and accepts the same staged inputs as tools',async()=>{
    const s=await setup(),handler=s.commands.get('loops')!.handler;
    const command=async(op:string,input:unknown={})=>{const reply=(await handler({...s.commandContext,args:`${op} ${JSON.stringify(input)}`})).text!;expect(reply.length).toBeLessThanOrEqual(8000);return JSON.parse(reply);};
    const {id:_id,revision:_revision,schemaVersion:_version,...definition}=structuredClone(examples[0]);definition.slug='command-large';
    definition.nodes=[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'{{input.text}}'}];definition.edges=[{id:'edge',source:'input',target:'return',port:'next'}];definition.capabilities=[];definition.limits.maxOutputBytes=1024*1024;
    await command('create',{definition});
    const text='🙂"\\'.repeat(15000),json=JSON.stringify({text}),characters=Array.from(json),sha256=createHash('sha256').update(json).digest('hex');
    let reference:unknown;
    for(let offset=0;offset<characters.length;offset+=16000){
      const response=await command('upload',{uploadId:'command-large-input',offset,text:characters.slice(offset,offset+16000).join(''),complete:offset+16000>=characters.length,sha256});reference=response.reference;
    }
    const run=await command('run',{slug:definition.slug,input:reference});expect(run).toMatchObject({state:'completed',resultTruncated:true});
    const inspection=await handler({...s.commandContext,args:`inspect ${JSON.stringify({runId:run.id})}`});
    expect(inspection.text).toContain('loops-document');expect(inspection.text).toContain('/loops document');
    const documentId=/"documentId": "([a-f0-9]{64})"/.exec(inspection.text!)![1];
    let full='',offset=0;while(true){const page=await command('document',{documentId,offset});full+=page.text;if(page.nextOffset===null)break;expect(page.nextOffset).toBeGreaterThan(offset);offset=page.nextOffset;}
    expect(JSON.parse(full)).toMatchObject({id:run.id,input:{text},result:text});
    expect((await handler({...s.commandContext,args:`status ${run.id}`})).text).toContain('Result preview');
    let output='';offset=0;while(true){const page=await command('output',{runId:run.id,offset});output+=page.text;if(page.nextOffset===null)break;offset=page.nextOffset;}
    expect(output).toBe(text);expect(s.complete).not.toHaveBeenCalled();
  });
  it('stages exact newline and Unicode input through encoded commands without bypassing authority',async()=>{
    const s=await setup(),handler=s.commands.get('loops')!.handler;
    const {id:_id,revision:_revision,schemaVersion:_version,...definition}=structuredClone(examples[0]);definition.slug='encoded-command';definition.capabilities=[];
    definition.nodes=[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'{{input.text}}'}];definition.edges=[{id:'edge',source:'input',target:'return',port:'next'}];definition.limits.maxOutputBytes=100000;
    await commandJson(s,'create',{definition});
    const text='完整 🙂\u0000"\\\n\\n'.repeat(500),json=JSON.stringify({text}),characters=Array.from(json);let reference;
    for(let offset=0;offset<characters.length;offset+=200){
      const input={uploadId:'encoded-upload',offset,text:characters.slice(offset,offset+200).join(''),complete:offset+200>=characters.length,sha256:createHash('sha256').update(json).digest('hex')};
      const args='upload --json-base64 '+Buffer.from(JSON.stringify(input)).toString('base64');expect(args.length).toBeLessThan(4096);expect(args.replace(/\\n/g,' ')).toBe(args);
      reference=JSON.parse((await handler({...s.commandContext,args,commandBody:'/loops '+args})).text!).reference;
    }
    const args='run --json-base64 '+Buffer.from(JSON.stringify({slug:definition.slug,input:reference,requestId:'encoded-run'})).toString('base64');
    expect((await handler({...s.commandContext,isAuthorizedSender:false,args})).text).toContain('Unauthorized');
    const run=JSON.parse((await handler({...s.commandContext,args})).text!);expect(run).toMatchObject({state:'completed',resultTruncated:true});
    expect(await commandJson(s,'inspect',{runId:run.id})).toMatchObject({input:{text},result:text});expect(s.complete).not.toHaveBeenCalled();
  });
  it('retrieves complete documents and outputs through actual direct and deferred SDK tool envelopes',async()=>{
    const s=await setup(),{id:_id,revision:_revision,schemaVersion:_version,...definition}=structuredClone(examples[0]);definition.slug='tool-envelope';definition.capabilities=[];
    const text='🙂\u0000"\\\n'.repeat(9000);definition.nodes=[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'{{input.text}}'}];definition.edges=[{id:'entry',source:'input',target:'return',port:'next'}];definition.limits.maxOutputBytes=1000000;
    await toolJson(s,'create',{definition});const run=await toolJson(s,'run',{slug:definition.slug,input:{text},requestId:'tool-complete'});expect(run).toMatchObject({state:'completed',resultTruncated:true});
    const inspected=await toolJson(s,'inspect',{runId:run.id});expect(inspected).toMatchObject({result:text,input:{text}});
    let output='',offset=0;while(true){const page=await toolJson(s,'output',{runId:run.id,offset,limit:100000});expect(page.offset).toBe(offset);output+=page.text;if(page.nextOffset===null)break;expect(page.nextOffset).toBe(offset+Array.from(page.text).length);offset=page.nextOffset;}
    expect(output).toBe(text);expect(s.complete).not.toHaveBeenCalled();
  },30_000);
  it('snapshots formatted command results and help, preserving pages through edits and restart',async()=>{
    const s=await setup(),handler=s.commands.get('loops')!.handler;
    const {id:_id,revision:_revision,schemaVersion:_version,...definition}=structuredClone(examples[0]);definition.slug='command-envelope';definition.capabilities=[];definition.inputSchema=[];
    definition.nodes=[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'x'.repeat(2800)}];definition.edges=[{id:'edge',source:'input',target:'return',port:'next'}];
    const args='create '+JSON.stringify({definition});expect(args.length).toBeLessThan(4096);
    const reply=(await handler({...s.commandContext,args})).text!;expect(reply.length).toBeLessThanOrEqual(8000);
    const reference=JSON.parse(reply.split('\n\nRead the full JSON result with ')[0]);expect(Value.Check(DocumentReferenceSchema,reference)).toBe(true);
    const first=await commandJson(s,'document',{documentId:reference.documentId,limit:7});expect(first.nextOffset).toBe(7);
    const tool=await s.tools.find(t=>t.name==='loops_document')!.execute('first-page',{documentId:reference.documentId,limit:7});expect(tool.details).toEqual(first);
    const id=(await commandJson(s,'browse',{search:definition.slug})).items[0].id;
    await commandJson(s,'edit',{id,expectedRevision:1,changes:{name:'Changed after snapshot'}});
    for(const service of s.services)await service.stop?.({} as Parameters<OpenClawPluginService['start']>[0]);
    const reopened=await setup({root:s.root});let full=first.text,offset=first.nextOffset;
    while(true){const page=await commandJson(reopened,'document',{documentId:reference.documentId,offset,limit:100000});expect(page.sha256).toBe(reference.sha256);full+=page.text;if(page.nextOffset===null)break;offset=page.nextOffset;}
    expect(createHash('sha256').update(full).digest('hex')).toBe(reference.sha256);expect(Buffer.byteLength(full)).toBe(reference.bytes);
    expect(JSON.parse(full)).toMatchObject({record:{definition:{name:definition.name,revision:1,nodes:definition.nodes},enabledRevision:1}});
    expect(await commandJson(reopened,'read',{id})).toMatchObject({definition:{name:'Changed after snapshot',revision:2}});
    const help=(await reopened.commands.get('loops')!.handler({...reopened.commandContext,args:'help test'})).text!;expect(help.length).toBeLessThanOrEqual(8000);
    const helpReference=JSON.parse(help.split('\n\nRead the full JSON result with ')[0]);expect(Value.Check(DocumentReferenceSchema,helpReference)).toBe(true);
    let helpText='';offset=0;while(true){const page=await commandJson(reopened,'document',{documentId:helpReference.documentId,offset});helpText+=page.text;if(page.nextOffset===null)break;offset=page.nextOffset;}
    expect(createHash('sha256').update(helpText).digest('hex')).toBe(helpReference.sha256);expect(JSON.parse(helpText)).toContain('Input schema:');
    expect(s.complete).not.toHaveBeenCalled();expect(reopened.complete).not.toHaveBeenCalled();
  });
  it('retains a committed mutation when its command response snapshot fails and recovers without repeating it',async()=>{
    const s=await setup(),handler=s.commands.get('loops')!.handler,directory=join(s.root,'loops-poc','documents');
    const {id:_id,revision:_revision,schemaVersion:_version,...definition}=structuredClone(examples[0]);definition.slug='snapshot-recovery';definition.capabilities=[];definition.inputSchema=[];
    definition.nodes=[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'x'.repeat(4000)}];definition.edges=[{id:'edge',source:'input',target:'return',port:'next'}];
    const created=await commandJson(s,'create',{definition}),id=created.record.definition.id;
    renameSync(directory,directory+'-held');writeFileSync(directory,'Synthetic directory fault');
    const args='edit '+JSON.stringify({id,expectedRevision:1,changes:{name:'Committed despite reply failure'}});
    try{
      const reply=(await handler({...s.commandContext,args})).text!;expect(reply).toContain('LOOPS_STORAGE_ACCESS');expect(reply).not.toContain(s.root);expect(reply.length).toBeLessThanOrEqual(8000);
      expect(await s.action('load',{id})).toMatchObject({result:{definition:{revision:2,name:'Committed despite reply failure'}}});
    }finally{rmSync(directory);renameSync(directory+'-held',directory);}
    expect((await handler({...s.commandContext,args})).text).toContain('LOOPS_REVISION_CONFLICT');
    expect(await commandJson(s,'read',{id})).toMatchObject({definition:{revision:2,name:'Committed despite reply failure'}});
    expect((await commandJson(s,'versions',{id})).map((v:{revision:number})=>v.revision)).toEqual([2,1]);expect(s.complete).not.toHaveBeenCalled();
  });
  it('restarts after a failed storage close instead of retaining a stopped executor',async()=>{
    const s=await setup(),service=s.services.find(service=>service.id==='loops-poc-store')!,ctx={} as Parameters<OpenClawPluginService['start']>[0];
    const post=Worker.prototype.postMessage;
    const spy=vi.spyOn(Worker.prototype,'postMessage').mockImplementation(function(this:Worker,message,transfers){return post.call(this,message.operation==='close'?{...message,operation:'injected-close-failure'}:message,transfers);});
    try{await expect(service.stop?.(ctx)).rejects.toThrow('Unknown service operation.');}finally{spy.mockRestore();}
    await service.start(ctx);
    expect(await s.action('load',{id:'summarize-text'})).toMatchObject({result:{definition:{id:'summarize-text',revision:1}}});
  });
  it('releases storage after engine startup fails so the repaired store can start',async()=>{
    const s=await setup({start:false}),service=s.services.find(service=>service.id==='loops-poc-store')!,ctx={} as Parameters<OpenClawPluginService['start']>[0];
    const filename=join(s.root,'loops-poc','loops.sqlite'),store=new SqliteStorage(filename),d={...structuredClone(examples[0]),revision:1};
    store.write({version:1,loops:{[d.id]:{definition:d,enabledRevision:null,grants:[]}},runs:{}});await store.close();
    const fault=new DatabaseSync(filename);
    try{
      fault.exec("CREATE TRIGGER reject_startup BEFORE INSERT ON metadata BEGIN SELECT RAISE(ABORT,'Injected startup commit failure'); END;");
      await expect(Promise.resolve().then(()=>service.start(ctx))).rejects.toMatchObject({detail:{code:'LOOPS_STORAGE_CONFLICT'},cause:{message:'Injected startup commit failure'}});
      fault.exec('DROP TRIGGER reject_startup');
    }finally{fault.close();}
    await service.start(ctx);shutdowns.push(async()=>{await service.stop?.(ctx);});
    expect(await s.action('load',{id:d.id})).toMatchObject({result:{definition:{id:d.id,revision:1}}});
  });
  it('surfaces known safe conflicts through the wire result and the shared UI client',async()=>{
    const s=await setup();await s.action('edit',{id:'summarize-text',expectedRevision:1,changes:{name:'Concurrent saved version'}});
    const transport={pluginId:'loops-poc',signal:new AbortController().signal,connection:{connected:true},onEvent:()=>()=>{},subscribe:()=>()=>{},request:async(_method:string,params:Record<string,unknown>)=>s.action(params.actionId as string,params.payload as Record<string,unknown>)} as FeatureTransport;
    const client=createLoopsClient(transport);
    await expect(client.invoke('edit',{id:'summarize-text',expectedRevision:1,changes:{name:'Must not replace'}})).rejects.toMatchObject({detail:{code:'LOOPS_REVISION_CONFLICT',message:expect.stringMatching(/Save conflict/)}});
    expect((await client.invoke('load',{id:'summarize-text'})).definition.name).toBe('Concurrent saved version');
    expect(await s.action('edit',{id:'summarize-text',expectedRevision:1,changes:{name:'Must not replace'}})).toMatchObject({result:{kind:'loops-error',operation:'edit',error:{code:'LOOPS_REVISION_CONFLICT'}}});
    await expect(client.invoke('enable',{id:'summarize-text',revision:1,enabled:true})).rejects.toMatchObject({detail:{code:'LOOPS_REVISION_CONFLICT'}});
    await client.invoke('enable',{id:'summarize-text',revision:2,enabled:true});
    await expect(client.invoke('run',{slug:'summarize-text',input:{text:'Synthetic input'}})).rejects.toMatchObject({detail:{message:'requestId is required for UI execution.'}});
    await expect(client.invoke('run',{slug:'summarize-text',input:{},requestId:'missing-input'})).rejects.toMatchObject({detail:{message:'Input text must be text.'}});
    expect(s.complete).not.toHaveBeenCalled();
  });
  it('reports actual rejected storage writes to UI, tools and commands without private trigger text or inference',async()=>{
    const s=await setup();await s.action('enable',{id:'summarize-text',revision:1,enabled:true});
    const fault=new DatabaseSync(join(s.root,'loops-poc','loops.sqlite'));
    const privateText='Synthetic private SQL and credential marker';
    const before=await s.action('runs',{});
    try{
      fault.exec(`CREATE TRIGGER reject_admission BEFORE INSERT ON runs BEGIN SELECT RAISE(ABORT,'${privateText}'); END;`);
      const ui=await s.action('run',{slug:'summarize-text',input:{text:'UI input'},requestId:'storage-ui'});
      const tool=await s.tools.find(tool=>tool.name==='loops_run')!.execute('storage-tool',{slug:'summarize-text',input:{text:'Tool input'}});
      const command=await s.commands.get('loops')!.handler({...s.commandContext,args:'run summarize-text Command input'});
      expect(ui).toMatchObject({result:{kind:'loops-error',error:{code:'LOOPS_STORAGE_CONFLICT',phase:'storage',retryable:false,recovery:expect.stringMatching(/Reload/)}}});
      expect(tool.details).toMatchObject({kind:'loops-error',error:{code:'LOOPS_STORAGE_CONFLICT'}});
      expect(command.text).toContain('LOOPS_STORAGE_CONFLICT');expect(command.text).toContain('Reload');expect(command.text).toContain('Phase: storage');expect(command.text).toContain('Retryable: Resolve the failure first');
      expect(JSON.stringify([ui,tool,command])).not.toContain(privateText);
      expect(await s.action('runs',{})).toEqual(before);expect(s.complete).not.toHaveBeenCalled();
      fault.exec('DROP TRIGGER reject_admission');
      const recovery=await s.tools.find(tool=>tool.name==='loops_run')!.execute('storage-recovered',{slug:'summarize-text',input:{text:'Explicit new request'}});
      expect(recovery.details).toMatchObject({state:'completed'});expect(s.complete).toHaveBeenCalledOnce();
    }finally{fault.close();}
  });
  it('reports inaccessible transport storage through UI, tools and commands and stops automatic upload before mutation',async()=>{
    const s=await setup(),before=await s.action('library',{}),directory=join(s.root,'loops-poc','documents'),backup=directory+'-before-fault';
    renameSync(directory,backup);writeFileSync(directory,'Private filesystem fault marker');
    const calls:string[]=[],transport={pluginId:'loops-poc',signal:new AbortController().signal,connection:{connected:true},onEvent:()=>()=>{},subscribe:()=>()=>{},request:async(_method:string,params:Record<string,unknown>)=>{
      calls.push(params.actionId as string);return s.action(params.actionId as string,params.payload as Record<string,unknown>);
    }} as FeatureTransport;
    const input={uploadId:'inaccessible',offset:0,text:'{}',complete:true,sha256:createHash('sha256').update('{}').digest('hex')};
    try{
      const ui=await s.action('upload',input),tool=await s.tools.find(tool=>tool.name==='loops_upload')!.execute('inaccessible-tool',input);
      const command=await s.commands.get('loops')!.handler({...s.commandContext,args:`upload ${JSON.stringify(input)}`});
      expect(ui).toMatchObject({result:{kind:'loops-error',operation:'upload',error:{code:'LOOPS_STORAGE_ACCESS',phase:'storage',recovery:expect.stringMatching(/permissions/)}}});
      expect(tool.details).toMatchObject({kind:'loops-error',operation:'upload',error:{code:'LOOPS_STORAGE_ACCESS'}});
      expect(command.text).toContain('LOOPS_STORAGE_ACCESS');expect(command.text).toContain('permissions');
      expect(JSON.stringify([ui,tool,command])).not.toContain(s.root);expect(JSON.stringify([ui,tool,command])).not.toContain('Private filesystem fault marker');
      await expect(createLoopsClient(transport).invoke('edit',{id:'summarize-text',expectedRevision:1,changes:{description:'x'.repeat(70000)}})).rejects.toMatchObject({detail:{code:'LOOPS_STORAGE_ACCESS'}});
      expect(calls).toEqual(['upload']);expect(s.complete).not.toHaveBeenCalled();
    }finally{rmSync(directory);renameSync(backup,directory);}
    expect(await s.action('library',{})).toEqual(before);
    expect(await s.action('upload',input)).toMatchObject({result:{completed:true,reference:{$loopsUpload:expect.any(String)}}});
  });
  it('retains a page-read failure through the UI client and document adapters without returning partial content',async()=>{
    const s=await setup(),directory=join(s.root,'loops-poc','documents'),calls:string[]=[];
    let damage=false,filename='',saved='';
    const transport={pluginId:'loops-poc',signal:new AbortController().signal,connection:{connected:true},onEvent:()=>()=>{},subscribe:()=>()=>{},request:async(_method:string,params:Record<string,unknown>)=>{
      calls.push(params.actionId as string);
      const payload=params.payload as Record<string,unknown>;
      if(damage&&params.actionId==='document'&&Number(payload.offset)>0){
        filename=join(directory,`document-${payload.documentId}.json`);saved=readFileSync(filename,'utf8');writeFileSync(filename,'{private damaged snapshot');damage=false;
      }
      return s.action(params.actionId as string,payload);
    }} as FeatureTransport;
    const client=createLoopsClient(transport),large='x'.repeat(70000),definition={...structuredClone(examples[0]),schemaVersion:2 as const,revision:1};
    definition.nodes=[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:large}];
    definition.edges=[{id:'edge',source:'input',target:'return',port:'next'}];definition.capabilities=[];
    await client.invoke('save',{definition,expectedRevision:1});calls.length=0;damage=true;
    try{
      await expect(client.invoke('load',{id:definition.id})).rejects.toMatchObject({detail:{code:'LOOPS_DOCUMENT_CORRUPT',phase:'storage'}});
      expect(calls).toEqual(['load','document','document']);
      const documentId=filename.slice(filename.lastIndexOf('document-')+9,-5),input={documentId,offset:16000};
      const ui=await s.action('document',input),tool=await s.tools.find(tool=>tool.name==='loops_document')!.execute('damaged-document',input);
      const command=await s.commands.get('loops')!.handler({...s.commandContext,args:`document ${JSON.stringify(input)}`});
      expect(ui).toMatchObject({result:{kind:'loops-error',operation:'document',error:{code:'LOOPS_DOCUMENT_CORRUPT'}}});
      expect(tool.details).toMatchObject({kind:'loops-error',operation:'document',error:{code:'LOOPS_DOCUMENT_CORRUPT'}});
      expect(command.text).toContain('LOOPS_DOCUMENT_CORRUPT');expect(command.text).toContain('Preserve');
      expect(JSON.stringify([ui,tool,command])).not.toContain('private damaged snapshot');expect(JSON.stringify([ui,tool,command])).not.toContain(s.root);
      expect(readFileSync(filename,'utf8')).toBe('{private damaged snapshot');
    }finally{if(filename)writeFileSync(filename,saved);}
    expect((await client.invoke('load',{id:definition.id})).definition.nodes[1]).toMatchObject({value:large});expect(s.complete).not.toHaveBeenCalled();
  });
  it('reports upload validation conflicts consistently and preserves the previously staged value',async()=>{
    const s=await setup(),input={uploadId:'conflict',offset:0,text:'{}'};await s.action('upload',input);
    const changed={...input,text:'[]'},ui=await s.action('upload',changed),tool=await s.tools.find(tool=>tool.name==='loops_upload')!.execute('upload-conflict',changed);
    const command=await s.commands.get('loops')!.handler({...s.commandContext,args:`upload ${JSON.stringify(changed)}`});
    expect(ui).toMatchObject({result:{kind:'loops-error',operation:'upload',error:{code:'LOOPS_UPLOAD_CONFLICT'}}});
    expect(tool.details).toMatchObject({kind:'loops-error',operation:'upload',error:{code:'LOOPS_UPLOAD_CONFLICT'}});expect(command.text).toContain('LOOPS_UPLOAD_CONFLICT');
    expect(await s.action('upload',{...input,complete:true,sha256:createHash('sha256').update(input.text).digest('hex')})).toMatchObject({result:{completed:true}});
    const files=readdirSync(join(s.root,'loops-poc','documents'));expect(files.filter(name=>name.endsWith('.tmp'))).toEqual([]);expect(files.filter(name=>name.startsWith('document-'))).toHaveLength(1);
    expect(s.complete).not.toHaveBeenCalled();
  });
  it('keeps provider credentials out of results and persisted history while identifying the failed node model',async()=>{
    const s=await setup(),nodes=structuredClone(examples[0].nodes),node=nodes[1];
    if(node.kind!=='inference')throw new Error('Expected fixture inference.');node.model='fake/node-override';
    await s.action('edit',{id:'summarize-text',expectedRevision:1,changes:{nodes},enabled:true});
    const secret='SYNTHETIC_PROVIDER_SECRET';
    const cause=Object.assign(new Error(`Authorization: Bearer ${secret}; requestBody=${secret}`),{status:401});
    s.complete.mockRejectedValue(Object.assign(new Error(`Runtime failed at https://${secret}@example.test`,{cause}),{code:'LLM_COMPLETION_FAILED'}));
    const tool=await s.tools.find(tool=>tool.name==='loops_run')!.execute('private-provider-tool',{slug:'summarize-text',input:{text:'Tool input'}});
    expect(tool.details).toMatchObject({state:'failed',errorDetail:{code:'HOST_AUTHENTICATION_FAILED',phase:'inference',nodeId:'summary',model:'fake/node-override',retryable:false}});
    const id=(tool.details as {id:string}).id,inspection=await s.action('inspect',{runId:id});
    const command=await s.commands.get('loops')!.handler({...s.commandContext,args:'run summarize-text Command input'});
    expect(command.text).toContain('HOST_AUTHENTICATION_FAILED');expect(command.text).toContain('Check or reconnect');
    expect(JSON.stringify([tool,inspection,command])).not.toContain(secret);
    const database=new DatabaseSync(join(s.root,'loops-poc','loops.sqlite'),{readOnly:true});
    try{expect(JSON.stringify(database.prepare('SELECT record FROM runs').all())).not.toContain(secret);expect(database.prepare('SELECT count(*) AS count FROM runs').get()?.count).toBe(2);}finally{database.close();}
    expect(s.complete).toHaveBeenCalledTimes(2);
  });
  it('exposes matching requested history cleanup to agent tools and authorized UI operations',async()=>{
    const s=await setup(),definition={...structuredClone(examples[0]),schemaVersion:2,capabilities:[],inputSchema:[],nodes:[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'Synthetic retained result'}],edges:[{id:'a',source:'input',target:'return',port:'next'}]};
    const run=(await s.tools.find(tool=>tool.name==='loops_test')!.execute('history-fixture',{definition,input:{}})).details as {id:string};
    const retention=s.tools.find(tool=>tool.name==='loops_retention')!;
    const preview=(await retention.execute('preview',{policy:{keepLatest:0}})).details as {planId:string;candidates:Array<{id:string}>};
    expect(preview.candidates.map(candidate=>candidate.id)).toEqual([run.id]);
    expect(await s.action('retention',{policy:{keepLatest:0},applyPlanId:preview.planId},['operator.read'])).toMatchObject({result:{kind:'loops-error',error:{message:expect.stringMatching(/authorized/)}}});
    expect(await s.action('retention',{policy:{keepLatest:0},applyPlanId:preview.planId})).toMatchObject({result:{applied:true,candidates:[{id:run.id}]}});
    expect((await s.tools.find(tool=>tool.name==='loops_test')!.execute('history-fixture',{definition,input:{}})).details).toMatchObject({kind:'loops-error',error:{code:'LOOPS_HISTORY_REMOVED'}});
    expect(s.complete).not.toHaveBeenCalled();
  });
  // This full lifecycle includes many durable writes and paged reads. Allow shared
  // CI runners a bounded 30 seconds while retaining every large-payload assertion.
  it('authors, executes, reads and edits large data through real SDK envelopes without losing content',async()=>{
    const s=await setup();
    const transport={pluginId:'loops-poc',signal:new AbortController().signal,connection:{connected:true},onEvent:()=>()=>{},subscribe:()=>()=>{},request:async(_method:string,params:Record<string,unknown>)=>{
      expect(fitsFeatureJson(params.payload)).toBe(true);
      const result=await s.action(params.actionId as string,params.payload as Record<string,unknown>);
      expect(fitsFeatureJson(result)).toBe(true);return result;
    }} as FeatureTransport;
    const client=createLoopsClient(transport);
    const {id:_id,revision:_revision,schemaVersion:_version,...definition}=structuredClone(examples[0]);definition.slug='large-transport';
    definition.nodes=[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Large result',value:'{{input.text}}'}];definition.edges=[{id:'edge',source:'input',target:'return',port:'next'}];definition.capabilities=[];definition.limits.maxOutputBytes=1024*1024;
    // Large node content exercises upload and all immutable revision reads.
    definition.nodes[1].label='Return';const large='🙂\u0000"\\'.repeat(24000);
    definition.nodes[1]={id:'return',kind:'return',label:'Return',value:large};
    const created=await client.invoke('create',{definition});const id=created.record.definition.id;
    expect(created.record.definition.nodes[1]).toMatchObject({value:large});
    const loaded=await client.invoke('load',{id});expect(loaded).toEqual(created.record);
    const run=await client.invoke('run',{slug:definition.slug,input:{text:large},requestId:'large-input'});
    expect(run).toMatchObject({state:'completed',resultTruncated:true});
    const inspected=await client.invoke('inspect',{runId:run.id});expect(inspected.result).toBe(large);expect(inspected.input.text).toBe(large);
    let output='',offset=0;while(true){const page=await client.invoke('output',{runId:run.id,offset,limit:100000});output+=page.text;if(page.nextOffset===null)break;expect(page.nextOffset).toBeGreaterThan(offset);offset=page.nextOffset;}
    expect(output).toBe(large);
    await client.invoke('edit',{id,expectedRevision:1,changes:{name:'Large edited'}});
    expect((await client.invoke('versions',{id})).map(v=>v.definition.nodes[1])).toEqual([loaded.definition.nodes[1],loaded.definition.nodes[1]]);
    const direct=(await s.tools.find(t=>t.name==='loops_read')!.execute('large-read',{id})).details as {kind:string;documentId:string};expect(direct.kind).toBe('loops-document');
    expect((await s.tools.find(t=>t.name==='loops_document')!.execute('large-page',{documentId:direct.documentId})).details).toHaveProperty('text');
    expect(s.complete).not.toHaveBeenCalled();
  },30_000);
  it('authorizes a human command review and rejects callers without human authority',async()=>{
    const s=await setup(),definition=structuredClone(examples[0]);definition.slug='command-review';definition.id='command-review';definition.revision=0;definition.capabilities=[];
    definition.nodes=[{id:'input',kind:'input',label:'Input'},{id:'review',kind:'review',label:'Review',proposal:'Synthetic review'},{id:'return',kind:'return',label:'Return',value:'approved'},{id:'fail',kind:'fail',label:'Fail',reason:'rejected'}];
    definition.edges=[{id:'a',source:'input',target:'review',port:'next'},{id:'b',source:'review',target:'return',port:'approve'},{id:'c',source:'review',target:'fail',port:'reject'}];
    await s.action('save',{definition,expectedRevision:0,enabled:true});
    const run=(await s.tools.find(t=>t.name==='loops_run')!.execute('review-run',{slug:definition.slug,input:{text:'Synthetic'}})).details as {id:string};
    const command=s.commands.get('loops')!;
    expect((await command.handler({...s.commandContext,gatewayClientScopes:['operator.write'],args:`review ${run.id} approve`})).text).toContain('authenticated human');
    expect((await command.handler({...s.commandContext,args:`review ${run.id} approve`})).text).toContain('completed');
    expect(s.tools.some(t=>t.name==='loops_review')).toBe(false);
  });
  it('round trips archived recovery through bounded-JSON SDK output validation',async()=>{
    const s=await setup();await s.action('archive',{id:'summarize-text',expectedRevision:1,archived:true});
    expect(await s.action('deleted',{})).toMatchObject({result:[{id:'summarize-text',archived:true}]});
    const rows=(await s.tools.find(t=>t.name==='loops_deleted')!.execute('archived-list',{})).details as object[];expect(rows[0]).not.toHaveProperty('deletedAt');
    expect(await s.action('recover',{id:'summarize-text',expectedRevision:1})).toMatchObject({result:{archived:false,enabledRevision:null}});
    expect(await s.action('deleted',{})).toMatchObject({result:[]});
  });
  it('shares the started executor with a separate tool registration scope',async()=>{const gateway=await setup();await gateway.action('enable',{id:'summarize-text',revision:1,enabled:true,grants:['llm']});const toolScope=await setup({root:gateway.root,start:false});const r=await toolScope.tools.find(t=>t.name==='loops_run')!.execute('registry-call',{slug:'summarize-text',input:{text:'A'}});expect(r.details).toMatchObject({state:'completed',definition:{revision:1}});expect(gateway.complete).toHaveBeenCalledOnce();expect(toolScope.complete).not.toHaveBeenCalled();});
  it('registers authoring and execution tools with a single command namespace',async()=>{const s=await setup();expect([...s.commands.keys()]).toEqual(['loops']);expect(s.tools.map(t=>t.name).sort()).toEqual(['loops_archive','loops_browse','loops_cancel','loops_capabilities','loops_create','loops_delete','loops_deleted','loops_describe','loops_document','loops_draft','loops_edit','loops_enable','loops_history','loops_inspect','loops_library','loops_list','loops_output','loops_publish','loops_read','loops_recover','loops_restore','loops_resume','loops_retention','loops_retry','loops_revoke','loops_run','loops_runs','loops_save','loops_status','loops_test','loops_upload','loops_validate','loops_versions']);expect(s.actions.size).toBe(34);expect(s.commands.get('loops')?.agentPromptGuidance?.join(' ')).toContain('loops_library');});
  it('authors through real SDK tools and shares definitions with the UI across registry scopes',async()=>{
    const gateway=await setup(),s=await setup({root:gateway.root,start:false});
    const call=(name:string,p:Record<string,unknown>)=>s.tools.find(t=>t.name===name)!.execute('authoring-call',p);
    expect((await call('loops_list',{})).details).toEqual([]);
    expect((await call('loops_library',{})).details).toHaveLength(3);
    expect((await call('loops_read',{id:'summarize-text'})).details).toMatchObject({enabledRevision:null,definition:{nodes:examples[0].nodes}});
    const {id:_id,revision:_revision,schemaVersion:_version,...definition}=structuredClone(examples[0]);
    definition.slug='adapter-created';
    const created=(await call('loops_create',{definition,enabled:false})).details as {record:{definition:{id:string;revision:number}}};
    const id=created.record.definition.id;
    expect(created).toMatchObject({record:{enabledRevision:null,grants:[],definition:{revision:1}}});
    expect((await call('loops_edit',{id,expectedRevision:1,changes:{name:'Edited by agent'}})).details).toMatchObject({record:{definition:{revision:2,name:'Edited by agent'}}});
    expect(await gateway.action('load',{id})).toMatchObject({result:{definition:{name:'Edited by agent',revision:2}}});
    expect((await call('loops_delete',{id,expectedRevision:2})).details).toMatchObject({deleted:true,id,revision:2});
    expect(await gateway.action('load',{id})).toMatchObject({result:{kind:'loops-error',error:{message:expect.stringMatching(/not found/)}}});
    expect(gateway.complete).not.toHaveBeenCalled();
  });
  it('rejects authoring identity or grant injection and stale revisions at the tool boundary',async()=>{
    const s=await setup(),edit=s.tools.find(t=>t.name==='loops_edit')!,del=s.tools.find(t=>t.name==='loops_delete')!;
    for(const changes of [{enabledRevision:1},{grants:['llm']},{id:'replacement'},{revision:99}])await expect(edit.execute('bad-patch',{id:'summarize-text',expectedRevision:1,changes})).rejects.toThrow(/schema/);
    await expect(edit.execute('forged',{id:'summarize-text',expectedRevision:1,changes:{name:'X'},agentId:'other'})).rejects.toThrow(/schema/);
    await edit.execute('current',{id:'summarize-text',expectedRevision:1,changes:{name:'Current'}});
    expect((await del.execute('stale',{id:'summarize-text',expectedRevision:1})).details).toMatchObject({kind:'loops-error',error:{code:'LOOPS_REVISION_CONFLICT'}});
    expect(await s.action('edit',{id:'summarize-text',expectedRevision:2,changes:{name:'Forbidden'}},['operator.read'])).toMatchObject({result:{kind:'loops-error',error:{message:expect.stringMatching(/authorized/)}}});
  });
  it('requires a matching host-resolved conversation for all authoring tools',async()=>{
    for(const context of [{agentId:'other'},{sessionKey:'agent:main:forged'},{sessionId:'forged'}]){
      const s=await setup({toolContext:context});
      await expect(s.tools.find(t=>t.name==='loops_library')!.execute('bad-reader',{})).rejects.toThrow();
      await expect(s.tools.find(t=>t.name==='loops_delete')!.execute('bad-author',{id:'summarize-text',expectedRevision:1})).rejects.toThrow();
    }
  });
  it('uses Codex-compatible array schemas without weakening ordered Repeat validation',async()=>{
    const s=await setup(),create=s.tools.find(t=>t.name==='loops_create')!;
    const inspect=(value:unknown)=>{if(!value||typeof value!=='object')return;const schema=value as Record<string,unknown>;if(schema.type==='array')expect(Array.isArray(schema.items)).toBe(false);for(const child of Object.values(schema))inspect(child);};inspect(create.parameters);
    const {id:_id,revision:_revision,schemaVersion:_version,...definition}=structuredClone(examples[1]);
    definition.slug='tuple-check';
    const repeat=definition.nodes.find(n=>n.kind==='repeat');if(!repeat||repeat.kind!=='repeat')throw Error();
    const wrong={...definition,nodes:definition.nodes.map(n=>n.id===repeat.id?{...repeat,body:[repeat.body[1],repeat.body[0]]}:n)};
    expect((await create.execute('reversed-tuple',{definition:wrong})).details).toMatchObject({kind:'loops-error',error:{message:expect.stringMatching(/schemaVersion 1/)}});
    expect((await create.execute('valid-tuple',{definition,enabled:false})).details).toMatchObject({issues:[],record:{definition:{revision:1},enabledRevision:null}});
  });
  it('executes command and tool against the same saved revision',async()=>{const s=await setup();await s.action('enable',{id:'summarize-text',revision:1,enabled:true,grants:['llm']});const command=s.commands.get('loops')!;const reply=await command.handler({...s.commandContext,args:'run summarize-text Supplied source',commandBody:'/loops run summarize-text Supplied source'});expect(reply.text).toContain('revision 1 · completed');expect(reply.text).toContain('An actual adapter result.');const result=await s.tools.find(t=>t.name==='loops_run')!.execute('host-tool-id',{slug:'summarize-text',input:{text:'Supplied source'}});expect(result.details).toMatchObject({state:'completed',source:'tool',requester:'host-sender',owner:{sessionId:s.sessionId},definition:{revision:1},result:'An actual adapter result.'});expect(s.complete).toHaveBeenCalledTimes(2);expect(s.complete.mock.calls[0]).toBeDefined();});
  it('keeps agent receipts compact while retaining full graphical evidence',async()=>{const s=await setup();await s.action('enable',{id:'summarize-text',revision:1,enabled:true,grants:['llm']});const result=await s.tools.find(t=>t.name==='loops_run')!.execute('compact',{slug:'summarize-text',input:{text:'A'}});const receipt=result.details as {id:string};expect(result.details).toMatchObject({models:['fake/test-only'],result:'An actual adapter result.'});expect(result.details).not.toHaveProperty('outputs');expect(JSON.stringify(result).length).toBeLessThan(5000);const inspected=await s.action('inspect',{runId:receipt.id});expect(inspected).toHaveProperty('result.trace');expect(inspected).toHaveProperty('result.outputs');});
  it('deduplicates repeated trusted tool calls and commands',async()=>{const s=await setup();await s.action('enable',{id:'summarize-text',revision:1,enabled:true,grants:['llm']});const t=s.tools.find(t=>t.name==='loops_run')!;const a=await t.execute('same-call',{slug:'summarize-text',input:{text:'A'}});const b=await t.execute('same-call',{slug:'summarize-text',input:{text:'A'}});expect(a.details).toEqual(b.details);const c={...s.commandContext,args:'run summarize-text A --request-id retry',commandBody:'/loops run summarize-text A --request-id retry'};expect((await s.commands.get('loops')!.handler(c)).text).toEqual((await s.commands.get('loops')!.handler(c)).text);expect(s.complete).toHaveBeenCalledTimes(2);});
  it('rejects identity injection before entering the service',async()=>{const s=await setup();await expect(s.tools.find(t=>t.name==='loops_run')!.execute('x',{slug:'summarize-text',input:{text:'A'},sessionId:'forged'})).rejects.toThrow(/schema/);});
  it('accepts the text shortcut with the same strict input validation and rejects ambiguous input',async()=>{const s=await setup();await s.action('enable',{id:'summarize-text',revision:1,enabled:true});const run=s.tools.find(t=>t.name==='loops_run')!;expect((await run.execute('shortcut',{slug:'summarize-text',text:'Source'})).details).toMatchObject({state:'completed'});expect((await run.execute('ambiguous',{slug:'summarize-text',text:'Source',input:{text:'Other'}})).details).toMatchObject({kind:'loops-error',error:{code:'LOOPS_INVALID_REQUEST',message:expect.stringMatching(/not both/)}});expect(s.complete).toHaveBeenCalledTimes(1);});
  it('allows operator-write activation while keeping human review separate',async()=>{
    const s=await setup();expect(s.tools.some(t=>t.name==='loops_review')).toBe(false);expect(s.tools.some(t=>t.name==='loops_save')).toBe(true);
    expect(await s.action('enable',{id:'summarize-text',revision:1,enabled:true},['operator.write'])).toMatchObject({result:{enabledRevision:1,grants:['llm']}});
    expect(await s.action('enable',{id:'summarize-text',revision:1,enabled:false},['operator.read'])).toMatchObject({result:{kind:'loops-error',error:{message:expect.stringMatching(/authorized/)}}});
    const d={...structuredClone(examples[0]),revision:1,name:'Saved and enabled by operator'};
    expect(await s.action('save',{definition:d,expectedRevision:1,enabled:true},['operator.write'])).toMatchObject({result:{record:{enabledRevision:2}}});
    expect(await s.action('review',{runId:'any',decision:'approve'},['operator.write'])).toMatchObject({result:{kind:'loops-error',error:{message:expect.stringMatching(/authenticated human/)}}});
  });
  it('creates enabled loops and controls activation through actual agent tools',async()=>{
    const s=await setup();const call=(name:string,p:Record<string,unknown>)=>s.tools.find(t=>t.name===name)!.execute('activation-call',p);
    const {id:_id,revision:_revision,schemaVersion:_version,...definition}=structuredClone(examples[0]);definition.slug='agent-published';
    const created=(await call('loops_create',{definition})).details as {record:{definition:{id:string}}};const id=created.record.definition.id;
    expect(created).toMatchObject({record:{enabledRevision:1,grants:['llm']}});
    expect((await call('loops_run',{slug:definition.slug,input:{text:'Actual invocation'}})).details).toMatchObject({state:'completed',result:'An actual adapter result.',definition:{revision:1}});
    expect((await call('loops_edit',{id,expectedRevision:1,changes:{name:'Enabled edit'}})).details).toMatchObject({record:{enabledRevision:2}});
    expect((await call('loops_enable',{id,revision:2,enabled:false})).details).toMatchObject({enabledRevision:null});
    expect((await call('loops_enable',{id,revision:2,enabled:true})).details).toMatchObject({enabledRevision:2});
    expect((await call('loops_revoke',{id})).details).toMatchObject({enabledRevision:null,grants:[]});
    expect(await toolJson(s,'edit',{id,expectedRevision:2,changes:{name:'Published again'},enabled:true})).toMatchObject({record:{enabledRevision:3}});
    expect(await toolJson(s,'edit',{id,expectedRevision:3,changes:{name:'Explicit draft'},enabled:false})).toMatchObject({record:{enabledRevision:null}});
    expect(s.complete).toHaveBeenCalledOnce();
  });
  it('returns truthful waits and refuses generic review approval',async()=>{const s=await setup();await s.action('enable',{id:'read-pause-continue',revision:1,enabled:true,grants:['llm','model-info']});const result=await s.tools.find(t=>t.name==='loops_run')!.execute('pause',{slug:'read-pause-continue',input:{text:'A'}});expect(result.details).toMatchObject({state:'waiting',definition:{revision:1}});expect(s.complete).not.toHaveBeenCalled();});
  it('rejects a host-revoked plugin after a tool factory was created',async()=>{const s=await setup();s.config.plugins.entries['loops-poc'].enabled=false;await expect(s.tools.find(t=>t.name==='loops_list')!.execute('disabled',{})).rejects.toThrow(/disabled/);});
  it('keeps command input bounded and distinguishes explicit retry IDs',async()=>{const s=await setup();expect(parseCommand({...s.commandContext,args:'run summarize-text hello --request-id once'})).toMatchObject({input:{text:'hello'},requestId:'command:once'});expect(()=>parseCommand({...s.commandContext,args:'run summarize-text '+'x'.repeat(19000)},16000)).toThrow(/large/);expect(parseCommand({...s.commandContext,args:'run summarize-text '+'x'.repeat(19000)})).toHaveProperty('input.text');});
});
