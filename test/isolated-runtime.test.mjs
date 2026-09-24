import {afterEach,describe,it,expect} from 'vitest';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,realpathSync,readdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {acquireLease,activeLease,admitOllamaArgs,admitOpenClawArgs,assertNode,assertSetupLocation,buildEnvironment,cleanEnvironment,installedHost,ollamaEnvironment,ollamaPort,portOccupied,profileEnvironment,runOllama,runOpenClaw} from '../scripts/isolated-runtime.mjs';

const roots=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
async function freePort(){
  const server=createServer();
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const port=server.address().port;
  await new Promise(done=>server.close(done));
  return port;
}
async function fixture(name='ollama'){
  const root=realpathSync(mkdtempSync(join(tmpdir(),'loops-isolated-')));roots.push(root);
  const module=join(root,'node_modules','openclaw'),profile=join(root,'.dev-profile',name==='ollama'?'':name);
  mkdirSync(module,{recursive:true});mkdirSync(join(profile,'workspace'),{recursive:true});
  writeFileSync(join(root,'package.json'),JSON.stringify({devDependencies:{openclaw:'2026.9.5'}}));
  writeFileSync(join(module,'package.json'),JSON.stringify({name:'openclaw',version:'2026.9.5'}));
  writeFileSync(join(module,'openclaw.mjs'),"import {writeFileSync} from 'node:fs'; writeFileSync(process.env.LOOPS_TEST_OUTPUT,JSON.stringify({args:process.argv.slice(2),env:process.env}));");
  const port=await freePort();
  writeFileSync(join(profile,'openclaw.json'),JSON.stringify({
    gateway:{mode:'local',bind:'loopback',port,auth:{mode:'token',token:'a'.repeat(64)}},
    discovery:{mdns:{mode:'off'}},browser:{enabled:false},logging:{file:join(profile,'gateway.log')},
    agents:{defaults:{workspace:join(profile,'workspace'),model:{primary:name==='ollama'?'ollama/test:latest':'openai/test',fallbacks:[]}}},
    models:{providers:name==='ollama'?{ollama:{baseUrl:'http://127.0.0.1:11439',api:'ollama',apiKey:'ollama-local',models:[]}}:{openai:{agentRuntime:{id:'codex'}}}},
  }));
  return {root,profile,module,port,output:join(root,'output.json')};
}
describe('isolated runtime admission',()=>{
  it('requires exact supported Node and project-pinned OpenClaw',async()=>{
    expect(()=>assertNode('v24.16.0')).not.toThrow();
    expect(()=>assertNode('v26.1.0')).not.toThrow();
    expect(()=>assertNode('v24.17.0')).toThrow(/exactly Node/);
    const f=await fixture();expect(installedHost(f.root)).toBe(join(f.module,'openclaw.mjs'));
    rmSync(f.module,{recursive:true});
    expect(()=>installedHost(f.root)).toThrow(/missing/);
  });
  it('initializes and admits an explicit alternate provider port in every environment',async()=>{
    const f=await fixture();
    rmSync(f.profile,{recursive:true});
    writeFileSync(join(f.root,'openclaw.plugin.json'),JSON.stringify({contracts:{tools:[]}}));
    const init=spawnSync(process.execPath,[resolve('scripts/init-profile.mjs')],{cwd:f.root,env:{...process.env,LOOPS_OLLAMA_PORT:'21439'},encoding:'utf8'});
    expect(init.status).toBe(0);
    const config=JSON.parse(readFileSync(join(f.profile,'openclaw.json')));
    expect(config.models.providers.ollama.baseUrl).toBe('http://127.0.0.1:21439');
    const source={LOOPS_OLLAMA_PORT:'21439'};
    expect(profileEnvironment(f.root,'ollama',source).port).toBe(19491);
    expect(ollamaEnvironment(f.root,source).OLLAMA_HOST).toBe('127.0.0.1:21439');
    expect(()=>profileEnvironment(f.root)).toThrow(/selected disposable worker endpoint/);
    expect(()=>ollamaEnvironment(f.root,{...source,OLLAMA_HOST:'127.0.0.1:11439'})).toThrow(/selected dedicated service/);
    await runOpenClaw(f.root,['config','validate'],{...source,LOOPS_TEST_OUTPUT:f.output});
    expect(JSON.parse(readFileSync(f.output)).args).toEqual(['config','validate']);
  });
  it('rejects invalid provider ports and refuses the selected occupied port',async()=>{
    for(const value of ['11434','18789','19491','19691','80','65536','abc','021439']){
      expect(()=>ollamaPort({LOOPS_OLLAMA_PORT:value})).toThrow();
    }
    expect(ollamaPort({LOOPS_OLLAMA_PORT:'21439'})).toBe(21439);
    const f=await fixture();
    const configFile=join(f.profile,'openclaw.json');
    const config=JSON.parse(readFileSync(configFile));
    const selected=await freePort();
    config.models.providers.ollama.baseUrl='http://127.0.0.1:'+selected;
    writeFileSync(configFile,JSON.stringify(config));
    const server=createServer();await new Promise(done=>server.listen(selected,'127.0.0.1',done));
    try{
      expect(await portOccupied(selected)).toBe(true);
      expect(()=>profileEnvironment(f.root,'ollama',{LOOPS_OLLAMA_PORT:'11439'})).toThrow(/selected disposable worker endpoint/);
      await expect(runOllama(f.root,['serve'],{LOOPS_OLLAMA_PORT:String(selected),LOOPS_OLLAMA_BIN:process.execPath})).rejects.toThrow(/Inference port is occupied/);
    }finally{await new Promise(done=>server.close(done));}
  });
  it('builds with no runtime profile and removes inherited provider credentials',async()=>{
    const f=await fixture();rmSync(f.profile,{recursive:true});
    const env=buildEnvironment(f.root,{OPENAI_API_KEY:'private',OPENCLAW_CONFIG_PATH:'/private/real',CODEX_HOME:'/private/codex',PATH:'/usr/bin'});
    expect(env.OPENAI_API_KEY).toBeUndefined();expect(env.OPENCLAW_CONFIG_PATH).toBeUndefined();
    expect(env.CODEX_HOME).toBeUndefined();expect(env.HOME).toContain('build-home');
    expect(env.OPENCLAW_HOME).toBe(env.HOME);expect(env.TMPDIR).toContain('build-home');
    await runOpenClaw(f.root,['plugins','build'],{LOOPS_TEST_OUTPUT:f.output,OPENAI_API_KEY:'private'});
    const result=JSON.parse(readFileSync(f.output));expect(result.args).toEqual(['plugins','build']);
    expect(result.env.OPENAI_API_KEY).toBeUndefined();expect(result.env.OPENCLAW_CONFIG_PATH).toBeUndefined();
  });
  it('passes a dedicated profile and strips provider credentials on a normal invocation',async()=>{
    const f=await fixture();
    await runOpenClaw(f.root,['config','validate'],{LOOPS_TEST_OUTPUT:f.output,OPENAI_API_KEY:'private',ANTHROPIC_AUTH_TOKEN:'private'});
    const result=JSON.parse(readFileSync(f.output));
    expect(result.env.OPENCLAW_CONFIG_PATH).toBe(join(f.profile,'openclaw.json'));
    expect(result.env.OPENCLAW_STATE_DIR).toBe(join(f.profile,'state'));
    expect(result.env.OPENCLAW_HOME).toBe(join(f.profile,'home'));
    expect(result.env.TMPDIR).toBe(join(f.profile,'tmp'));
    expect(result.env.XDG_CACHE_HOME).toBe(join(f.profile,'cache'));
    expect(result.env.PLAYWRIGHT_BROWSERS_PATH).toBe(join(f.profile,'browser'));
    expect(result.env.HOME).toBe(join(f.profile,'home'));
    expect(result.env.OPENAI_API_KEY).toBeUndefined();expect(result.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });
  it('rejects foreign profile paths and malformed workspace before dispatch',async()=>{
    const f=await fixture();
    expect(()=>profileEnvironment(f.root,'ollama',{OPENCLAW_CONFIG_PATH:'/private/real/openclaw.json'})).toThrow(/outside/);
    expect(()=>profileEnvironment(f.root,'ollama',{OPENCLAW_STATE_DIR:'/private/real/state'})).toThrow(/outside/);
    expect(()=>profileEnvironment(f.root,'ollama',{OPENCLAW_HOME:'/private/real/home'})).toThrow(/outside/);
    const config=JSON.parse(readFileSync(join(f.profile,'openclaw.json')));
    config.agents.defaults.workspace='/private/real/workspace';
    writeFileSync(join(f.profile,'openclaw.json'),JSON.stringify(config));
    expect(()=>profileEnvironment(f.root)).toThrow(/Workspace/);
    expect(()=>readFileSync(f.output)).toThrow();
  });
  it('rejects symlinked development paths before build or runtime dispatch',async()=>{
    const f=await fixture(),foreign=mkdtempSync(join(tmpdir(),'loops-foreign-'));roots.push(foreign);
    rmSync(f.profile,{recursive:true});symlinkSync(foreign,f.profile);
    expect(()=>assertSetupLocation(f.root,'ollama')).toThrow(/redirect/);
    expect(()=>buildEnvironment(f.root)).toThrow(/redirect/);
    expect(()=>profileEnvironment(f.root)).toThrow(/redirect/);
  });
  it('rejects dangling config links before setup can write through them',async()=>{
    const f=await fixture(),config=join(f.profile,'openclaw.json');
    rmSync(config);symlinkSync(join(f.root,'missing-target.json'),config);
    expect(()=>assertSetupLocation(f.root,'ollama')).toThrow();
  });
  it('refuses an occupied Gateway port and port overrides',async()=>{
    const f=await fixture('codex-test');
    const server=createServer();await new Promise(done=>server.listen(f.port,'127.0.0.1',done));
    try{
      expect(await portOccupied(f.port)).toBe(true);
      await expect(runOpenClaw(f.root,['gateway','run'],{LOOPS_PROFILE:'codex-test',LOOPS_TEST_OUTPUT:f.output})).rejects.toThrow(/occupied/);
      await expect(runOpenClaw(f.root,['gateway','run','--port','9999'],{LOOPS_PROFILE:'codex-test',LOOPS_TEST_OUTPUT:f.output})).rejects.toThrow(/not admitted/);
      await expect(runOpenClaw(f.root,['gateway','call','chat.history','--params','{}','--json'],{LOOPS_PROFILE:'codex-test',LOOPS_TEST_OUTPUT:f.output})).rejects.toThrow(/own ready service/);
      expect(()=>readFileSync(f.output)).toThrow();
    }finally{await new Promise(done=>server.close(done));}
  });
  it('releases its Gateway lease after the owned child exits',async()=>{
    const f=await fixture('codex-test'),lease=join(f.profile,'gateway.lease.json');
    await runOpenClaw(f.root,['gateway','run'],{LOOPS_PROFILE:'codex-test',LOOPS_TEST_OUTPUT:f.output});
    expect(JSON.parse(readFileSync(f.output)).args).toEqual(['gateway','run']);
    expect(()=>readFileSync(lease)).toThrow();
    const receipts=readdirSync(join(f.profile,'receipts'));
    expect(receipts).toHaveLength(1);
    const cleanup=JSON.parse(readFileSync(join(f.profile,'receipts',receipts[0])));
    expect(cleanup.leaseRemoved).toBe(true);expect(cleanup.childAlive).toBe(false);
    expect(cleanup.childPid).toBeGreaterThan(0);expect(cleanup.exitCode).toBe(0);
    expect(cleanup.endedAt).toBeTruthy();
  });
  it('allows only one live lease and removes only its own receipt',async()=>{
    const f=await fixture(),file=join(f.root,'lease.json');
    const release=acquireLease(file,'inference-worker');
    expect(()=>acquireLease(file,'inference-worker')).toThrow(/another live process/);
    release.release();expect(()=>readFileSync(file)).toThrow();
    const next=acquireLease(file,'inference-worker');next.release();
    expect(()=>readFileSync(file)).toThrow();
  });
  it('requires a live owned child and ready phase before service reuse',async()=>{
    const f=await fixture(),file=join(f.root,'lease.json'),owner=f.root;
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    try{
      const lease=acquireLease(file,'inference-worker',owner,null,21439);
      lease.markChild(child.pid);
      expect(activeLease(file,'inference-worker',owner,21439)).toBe(false);
      lease.markReady();
      expect(activeLease(file,'inference-worker',owner,21439)).toBe(true);
      expect(activeLease(file,'inference-worker',owner,11439)).toBe(false);
      expect(activeLease(file,'inference-worker','/other/worktree',21439)).toBe(false);
      const receipt=JSON.parse(readFileSync(file));
      receipt.parentPid=99999999;writeFileSync(file,JSON.stringify(receipt));
      expect(()=>acquireLease(file,'inference-worker',owner)).toThrow(/another live process/);
      child.kill('SIGTERM');await new Promise(done=>child.once('exit',done));
      expect(activeLease(file,'inference-worker',owner)).toBe(false);
      const recovered=acquireLease(file,'inference-worker',owner);recovered.release();
    }finally{if(child.exitCode===null)child.kill('SIGKILL');}
  });
  it('forwards SIGTERM only to its child and releases the owned lease',async()=>{
    const f=await fixture(),lease=join(f.root,'term.lease.json'),pidFile=join(f.root,'child.pid');
    const helper=pathToFileURL(resolve('scripts/isolated-runtime.mjs')).href;
    const childFile=join(f.root,'child.mjs'),runner=join(f.root,'runner.mjs');
    writeFileSync(childFile,"import {writeFileSync} from 'node:fs'; writeFileSync(process.env.LOOPS_TEST_OUTPUT,String(process.pid)); setInterval(()=>{},1000);");
    writeFileSync(runner,'import {runOwned,acquireLease} from '+JSON.stringify(helper)+'; await runOwned(process.execPath,['+JSON.stringify(childFile)+'],{...process.env,LOOPS_TEST_OUTPUT:'+JSON.stringify(pidFile)+'},acquireLease('+JSON.stringify(lease)+',\'gateway\',null,'+JSON.stringify(join(f.root,'receipts'))+'));');
    const parent=spawn(process.execPath,[runner],{stdio:'ignore'});
    try{
      for(let attempt=0;attempt<100&&!existsSync(pidFile);attempt++)await new Promise(done=>setTimeout(done,20));
      expect(existsSync(pidFile)).toBe(true);expect(existsSync(lease)).toBe(true);
      const childPid=Number(readFileSync(pidFile,'utf8'));
      parent.kill('SIGTERM');
      await new Promise(done=>parent.once('exit',done));
      expect(existsSync(lease)).toBe(false);
      expect(()=>process.kill(childPid,0)).toThrow();
      const receipt=JSON.parse(readFileSync(join(f.root,'receipts',readdirSync(join(f.root,'receipts'))[0])));
      expect(receipt.signal).toBe('SIGTERM');expect(receipt.leaseRemoved).toBe(true);
    }finally{if(parent.exitCode===null)parent.kill('SIGKILL');}
  });
  it('sanitizes inherited host and provider variables',()=>{
    expect(cleanEnvironment({PATH:'/usr/bin',OPENCLAW_STATE_DIR:'/private',OLLAMA_HOST:'remote',GOOGLE_API_KEY:'secret',OPENAI_ORG_ID:'private',AWS_SECRET_ACCESS_KEY:'secret',PUPPETEER_CACHE_DIR:'/private'})).toEqual({PATH:'/usr/bin'});
  });
  it('admits documented CLI shapes and rejects host, auth, and path overrides',async()=>{
    const f=await fixture(),archive=join(f.root,'candidate.tgz');writeFileSync(archive,'fixture');
    expect(admitOpenClawArgs(f.root,['plugins','build'])).toBe('build');
    expect(admitOpenClawArgs(f.root,['plugins','install','npm-pack:'+archive,'--force','--accept-capabilities'])).toBe('runtime');
    expect(admitOpenClawArgs(f.root,['gateway','call','plugins.sessionAction','--params','{}','--json','--timeout','60000'])).toBe('gateway-call');
    expect(admitOpenClawArgs(f.root,['agent','--agent','main','--session-key','synthetic','--message','hello','--json'])).toBe('agent');
    for(const args of [
      ['gateway','run','--bind','lan'],['gateway','run','--auth','none'],['gateway','run','--token','foreign'],
      ['gateway','run','--port=18789'],['config','set','gateway.bind','lan'],
      ['gateway','call','config.set','--params','{}','--json'],
      ['plugins','install','npm-pack:/private/foreign.tgz'],
    ])expect(()=>admitOpenClawArgs(f.root,args)).toThrow();
    expect(admitOllamaArgs(['serve'])).toBe('serve');
    expect(admitOllamaArgs(['pull','qwen3.5:4b'])).toBe('pull');
    expect(()=>admitOllamaArgs(['serve','--host','0.0.0.0'])).toThrow();
  });
  it('rejects personal or cloud provider routes in an edited profile',async()=>{
    const f=await fixture(),file=join(f.profile,'openclaw.json'),original=JSON.parse(readFileSync(file));
    for(const edit of [
      config=>{config.models.providers.ollama.baseUrl='http://127.0.0.1:11434';},
      config=>{config.models.providers.openai={apiKey:'private'};},
      config=>{config.agents.defaults.model.fallbacks=['openai/gpt'];},
      config=>{config.plugins={load:{paths:['/private/foreign-plugin']}};},
      config=>{config.gateway.port=18789;},
    ]){
      const config=structuredClone(original);edit(config);writeFileSync(file,JSON.stringify(config));
      expect(()=>profileEnvironment(f.root)).toThrow();
    }
    writeFileSync(file,JSON.stringify(original));
    expect(profileEnvironment(f.root).env.OPENCLAW_HOME).toBe(join(f.profile,'home'));
  });
  it('rejects symlinked XDG and service-home directories',async()=>{
    const f=await fixture(),foreign=realpathSync(mkdtempSync(join(tmpdir(),'loops-foreign-')));roots.push(foreign);
    symlinkSync(foreign,join(f.profile,'xdg-config'));
    expect(()=>profileEnvironment(f.root)).toThrow(/symlink/);
    symlinkSync(foreign,join(f.profile,'ollama-home'));
    expect(()=>ollamaEnvironment(f.root)).toThrow(/symlink/);
    symlinkSync(foreign,join(f.root,'foreign-lease-parent'));
    expect(()=>acquireLease(join(f.root,'foreign-lease-parent','lease.json'),'gateway')).toThrow(/symlink/);
  });
});
