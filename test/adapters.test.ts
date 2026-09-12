import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {OpenClawPluginApi,OpenClawPluginToolContext,PluginCommandContext,PluginSessionActionRegistration,OpenClawPluginService,OpenClawPluginCommandDefinition} from 'openclaw/plugin-sdk/plugin-entry';
import sourcePlugin from '../src/index.js';
const plugin:typeof sourcePlugin=process.env.LOOPS_TEST_PLUGIN?(await import(/* @vite-ignore */ process.env.LOOPS_TEST_PLUGIN)).default:sourcePlugin;
import {parseCommand} from '../src/openclaw.js';
import {examples} from '../src/examples.js';
type ToolRegistration=Parameters<OpenClawPluginApi['registerTool']>[0];
const directories:string[]=[];
const shutdowns:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const shutdown of shutdowns.splice(0))await shutdown();for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});});
function setup(options?:{root?:string;start?:boolean;toolContext?:Partial<OpenClawPluginToolContext>}){
  const root=options?.root??mkdtempSync(join(tmpdir(),'loops-adapters-'));if(!options?.root)directories.push(root);
  const commands=new Map<string,OpenClawPluginCommandDefinition>(),actions=new Map<string,PluginSessionActionRegistration>(),registered:ToolRegistration[]=[];const services:OpenClawPluginService[]=[];
  const key='agent:main:adapter-test',sessionId='adapter-session';
  // The real published feature SDK registers these adapters. Only host capabilities are faked.
  const complete=vi.fn(async()=>({text:'An actual adapter result.',provider:'fake',model:'test-only',agentId:'main',usage:{},execution:{mode:'isolated-agent-runtime',owner:{kind:'harness',id:'fake'}},audit:{caller:{kind:'plugin',id:'loops-poc'}}}));
  const config={plugins:{entries:{'loops-poc':{enabled:true}}}};
  const api={id:'loops-poc',config,runtime:{config:{current:()=>config},state:{resolveStateDir:()=>root},agent:{session:{getSessionEntry:({agentId,sessionKey}:{agentId:string;sessionKey:string})=>agentId==='main'&&sessionKey===key?{sessionId}:undefined}},llm:{complete},modelConfig:{resolveDefaultModelForAgent:()=>({provider:'fake',model:'test-only'})}},registerCommand:(c:OpenClawPluginCommandDefinition)=>commands.set(c.name,c),registerSessionAction:(a:PluginSessionActionRegistration)=>actions.set(a.id,a),registerTool:(t:ToolRegistration)=>registered.push(t),registerService:(s:OpenClawPluginService)=>services.push(s)} as unknown as OpenClawPluginApi;
  plugin.register(api);
  if(options?.start!==false)for(const s of services){s.start({} as Parameters<OpenClawPluginService['start']>[0]);shutdowns.push(async()=>{await s.stop?.({} as Parameters<OpenClawPluginService['start']>[0]);});}
  const toolContext:OpenClawPluginToolContext={agentId:'main',sessionKey:key,sessionId,requesterSenderId:'host-sender',...options?.toolContext};
  const tools=registered.flatMap(t=>{const value=typeof t==='function'?t(toolContext):t;return Array.isArray(value)?value:value?[value]:[];});
  const commandContext={agentId:'main',sessionKey:key,sessionId,senderId:'host-sender',channel:'webchat',isAuthorizedSender:true,gatewayClientScopes:['operator.admin','operator.write'],config} as unknown as PluginCommandContext;
  const action=(id:string,payload:Record<string,unknown>,scopes=['operator.admin','operator.write','operator.read'])=>actions.get(id)!.handler({pluginId:'loops-poc',actionId:id,agentId:'main',sessionKey:key,payload:payload as never,client:{connId:'human',scopes}});
  return {root,commands,actions,tools,complete,commandContext,action,config,key,sessionId};
}
describe('actual OpenClaw feature SDK adapters (fake model transport)',()=>{
  it('round trips archived recovery through bounded-JSON SDK output validation',async()=>{
    const s=setup();await s.action('archive',{id:'summarize-text',expectedRevision:1,archived:true});
    expect(await s.action('deleted',{})).toMatchObject({result:[{id:'summarize-text',archived:true}]});
    const rows=(await s.tools.find(t=>t.name==='loops_deleted')!.execute('archived-list',{})).details as object[];expect(rows[0]).not.toHaveProperty('deletedAt');
    expect(await s.action('recover',{id:'summarize-text',expectedRevision:1})).toMatchObject({result:{archived:false,enabledRevision:null}});
    expect(await s.action('deleted',{})).toMatchObject({result:[]});
  });
  it('shares the started executor with a separate tool registration scope',async()=>{const gateway=setup();await gateway.action('enable',{id:'summarize-text',revision:1,enabled:true,grants:['llm']});const toolScope=setup({root:gateway.root,start:false});const r=await toolScope.tools.find(t=>t.name==='loops_run')!.execute('registry-call',{slug:'summarize-text',input:{text:'A'}});expect(r.details).toMatchObject({state:'completed',definition:{revision:1}});expect(gateway.complete).toHaveBeenCalledOnce();expect(toolScope.complete).not.toHaveBeenCalled();});
  it('registers authoring and execution tools with a single command namespace',()=>{const s=setup();expect([...s.commands.keys()]).toEqual(['loops']);expect(s.tools.map(t=>t.name).sort()).toEqual(['loops_archive','loops_cancel','loops_capabilities','loops_create','loops_delete','loops_deleted','loops_describe','loops_draft','loops_edit','loops_enable','loops_history','loops_inspect','loops_library','loops_list','loops_output','loops_publish','loops_read','loops_recover','loops_restore','loops_resume','loops_retry','loops_revoke','loops_run','loops_runs','loops_status','loops_test','loops_validate','loops_versions']);expect(s.actions.size).toBe(30);expect(s.commands.get('loops')?.agentPromptGuidance?.join(' ')).toContain('loops_library');});
  it('authors through real SDK tools and shares definitions with the UI across registry scopes',async()=>{
    const gateway=setup(),s=setup({root:gateway.root,start:false});
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
    await expect(gateway.action('load',{id})).rejects.toThrow(/not found/);
    expect(gateway.complete).not.toHaveBeenCalled();
  });
  it('rejects authoring identity or grant injection and stale revisions at the tool boundary',async()=>{
    const s=setup(),edit=s.tools.find(t=>t.name==='loops_edit')!,del=s.tools.find(t=>t.name==='loops_delete')!;
    for(const changes of [{enabledRevision:1},{grants:['llm']},{id:'replacement'},{revision:99}])await expect(edit.execute('bad-patch',{id:'summarize-text',expectedRevision:1,changes})).rejects.toThrow(/schema/);
    await expect(edit.execute('forged',{id:'summarize-text',expectedRevision:1,changes:{name:'X'},agentId:'other'})).rejects.toThrow(/schema/);
    await edit.execute('current',{id:'summarize-text',expectedRevision:1,changes:{name:'Current'}});
    await expect(del.execute('stale',{id:'summarize-text',expectedRevision:1})).rejects.toThrow(/conflict/);
    await expect(s.action('edit',{id:'summarize-text',expectedRevision:2,changes:{name:'Forbidden'}},['operator.read'])).rejects.toThrow(/authorized/);
  });
  it('requires a trusted main-agent conversation for all authoring tools',async()=>{
    for(const context of [{agentId:'other'},{sessionKey:'agent:main:forged'},{sessionId:'forged'}]){
      const s=setup({toolContext:context});
      await expect(s.tools.find(t=>t.name==='loops_library')!.execute('bad-reader',{})).rejects.toThrow();
      await expect(s.tools.find(t=>t.name==='loops_delete')!.execute('bad-author',{id:'summarize-text',expectedRevision:1})).rejects.toThrow();
    }
  });
  it('uses Codex-compatible array schemas without weakening ordered Repeat validation',async()=>{
    const s=setup(),create=s.tools.find(t=>t.name==='loops_create')!;
    const inspect=(value:unknown)=>{if(!value||typeof value!=='object')return;const schema=value as Record<string,unknown>;if(schema.type==='array')expect(Array.isArray(schema.items)).toBe(false);for(const child of Object.values(schema))inspect(child);};inspect(create.parameters);
    const {id:_id,revision:_revision,schemaVersion:_version,...definition}=structuredClone(examples[1]);
    definition.slug='tuple-check';
    const repeat=definition.nodes.find(n=>n.kind==='repeat');if(!repeat||repeat.kind!=='repeat')throw Error();
    const wrong={...definition,nodes:definition.nodes.map(n=>n.id===repeat.id?{...repeat,body:[repeat.body[1],repeat.body[0]]}:n)};
    await expect(create.execute('reversed-tuple',{definition:wrong})).rejects.toThrow(/schemaVersion 1/);
    expect((await create.execute('valid-tuple',{definition,enabled:false})).details).toMatchObject({issues:[],record:{definition:{revision:1},enabledRevision:null}});
  });
  it('executes command and tool against the same saved revision',async()=>{const s=setup();await s.action('enable',{id:'summarize-text',revision:1,enabled:true,grants:['llm']});const command=s.commands.get('loops')!;const reply=await command.handler({...s.commandContext,args:'run summarize-text Supplied source',commandBody:'/loops run summarize-text Supplied source'});expect(reply.text).toContain('revision 1 · completed');expect(reply.text).toContain('An actual adapter result.');const result=await s.tools.find(t=>t.name==='loops_run')!.execute('host-tool-id',{slug:'summarize-text',input:{text:'Supplied source'}});expect(result.details).toMatchObject({state:'completed',source:'tool',requester:'host-sender',owner:{sessionId:s.sessionId},definition:{revision:1},result:'An actual adapter result.'});expect(s.complete).toHaveBeenCalledTimes(2);expect(s.complete.mock.calls[0]).toBeDefined();});
  it('keeps agent receipts compact while retaining full graphical evidence',async()=>{const s=setup();await s.action('enable',{id:'summarize-text',revision:1,enabled:true,grants:['llm']});const result=await s.tools.find(t=>t.name==='loops_run')!.execute('compact',{slug:'summarize-text',input:{text:'A'}});const receipt=result.details as {id:string};expect(result.details).toMatchObject({models:['fake/test-only'],result:'An actual adapter result.'});expect(result.details).not.toHaveProperty('outputs');expect(JSON.stringify(result).length).toBeLessThan(5000);const inspected=await s.action('inspect',{runId:receipt.id});expect(inspected).toHaveProperty('result.trace');expect(inspected).toHaveProperty('result.outputs');});
  it('deduplicates repeated trusted tool calls and commands',async()=>{const s=setup();await s.action('enable',{id:'summarize-text',revision:1,enabled:true,grants:['llm']});const t=s.tools.find(t=>t.name==='loops_run')!;const a=await t.execute('same-call',{slug:'summarize-text',input:{text:'A'}});const b=await t.execute('same-call',{slug:'summarize-text',input:{text:'A'}});expect(a.details).toEqual(b.details);const c={...s.commandContext,args:'run summarize-text A --request-id retry',commandBody:'/loops run summarize-text A --request-id retry'};expect((await s.commands.get('loops')!.handler(c)).text).toEqual((await s.commands.get('loops')!.handler(c)).text);expect(s.complete).toHaveBeenCalledTimes(2);});
  it('rejects identity injection before entering the service',async()=>{const s=setup();await expect(s.tools.find(t=>t.name==='loops_run')!.execute('x',{slug:'summarize-text',input:{text:'A'},sessionId:'forged'})).rejects.toThrow(/schema/);});
  it('accepts the text shortcut with the same strict input validation and rejects ambiguous input',async()=>{const s=setup();await s.action('enable',{id:'summarize-text',revision:1,enabled:true});const run=s.tools.find(t=>t.name==='loops_run')!;expect((await run.execute('shortcut',{slug:'summarize-text',text:'Source'})).details).toMatchObject({state:'completed'});await expect(run.execute('ambiguous',{slug:'summarize-text',text:'Source',input:{text:'Other'}})).rejects.toThrow(/not both/);});
  it('allows operator-write activation while keeping human review separate',async()=>{
    const s=setup();expect(s.tools.some(t=>/save|review/.test(t.name))).toBe(false);
    expect(await s.action('enable',{id:'summarize-text',revision:1,enabled:true},['operator.write'])).toMatchObject({result:{enabledRevision:1,grants:['llm']}});
    await expect(s.action('enable',{id:'summarize-text',revision:1,enabled:false},['operator.read'])).rejects.toThrow(/authorized/);
    const d={...structuredClone(examples[0]),revision:1,name:'Saved and enabled by operator'};
    expect(await s.action('save',{definition:d,expectedRevision:1,enabled:true},['operator.write'])).toMatchObject({result:{record:{enabledRevision:2}}});
    await expect(s.action('review',{runId:'any',decision:'approve'},['operator.write'])).rejects.toThrow(/human/);
  });
  it('creates enabled loops and controls activation through actual agent tools',async()=>{
    const s=setup();const call=(name:string,p:Record<string,unknown>)=>s.tools.find(t=>t.name===name)!.execute('activation-call',p);
    const {id:_id,revision:_revision,schemaVersion:_version,...definition}=structuredClone(examples[0]);definition.slug='agent-published';
    const created=(await call('loops_create',{definition})).details as {record:{definition:{id:string}}};const id=created.record.definition.id;
    expect(created).toMatchObject({record:{enabledRevision:1,grants:['llm']}});
    expect((await call('loops_run',{slug:definition.slug,input:{text:'Actual invocation'}})).details).toMatchObject({state:'completed',result:'An actual adapter result.',definition:{revision:1}});
    expect((await call('loops_edit',{id,expectedRevision:1,changes:{name:'Enabled edit'}})).details).toMatchObject({record:{enabledRevision:2}});
    expect((await call('loops_enable',{id,revision:2,enabled:false})).details).toMatchObject({enabledRevision:null});
    expect((await call('loops_enable',{id,revision:2,enabled:true})).details).toMatchObject({enabledRevision:2});
    expect((await call('loops_revoke',{id})).details).toMatchObject({enabledRevision:null,grants:[]});
    expect((await call('loops_edit',{id,expectedRevision:2,changes:{name:'Published again'},enabled:true})).details).toMatchObject({record:{enabledRevision:3}});
    expect((await call('loops_edit',{id,expectedRevision:3,changes:{name:'Explicit draft'},enabled:false})).details).toMatchObject({record:{enabledRevision:null}});
    expect(s.complete).toHaveBeenCalledOnce();
  });
  it('returns truthful waits and refuses generic review approval',async()=>{const s=setup();await s.action('enable',{id:'read-pause-continue',revision:1,enabled:true,grants:['llm','model-info']});const result=await s.tools.find(t=>t.name==='loops_run')!.execute('pause',{slug:'read-pause-continue',input:{text:'A'}});expect(result.details).toMatchObject({state:'waiting',definition:{revision:1}});expect(s.complete).not.toHaveBeenCalled();});
  it('rejects a host-revoked plugin after a tool factory was created',async()=>{const s=setup();s.config.plugins.entries['loops-poc'].enabled=false;await expect(s.tools.find(t=>t.name==='loops_list')!.execute('disabled',{})).rejects.toThrow(/disabled/);});
  it('keeps command input bounded and distinguishes explicit retry IDs',()=>{const s=setup();expect(parseCommand({...s.commandContext,args:'run summarize-text hello --request-id once'})).toMatchObject({input:{text:'hello'},requestId:'command:once'});expect(()=>parseCommand({...s.commandContext,args:'run summarize-text '+'x'.repeat(19000)})).toThrow(/large/);});
});
