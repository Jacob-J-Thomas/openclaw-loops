import {afterEach,describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdtempSync,mkdirSync,readFileSync,realpathSync,readdirSync,renameSync,rmdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {acquireLease,activeLease,admitOllamaArgs,admitOpenClawArgs,assertNode,assertSetupLocation,buildEnvironment,cleanEnvironment,globalInferenceLease,installedHost,ollamaEnvironment,ollamaPort,ownedLoopbackListener,portOccupied,profileEnvironment,runOllama,runOpenClaw,runOwned} from '../scripts/isolated-runtime.mjs';
import {installedProfilePlugin} from '../scripts/profile-plugin-status.mjs';

const roots=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function publishMarker(file,value){const staged=file+'.'+process.pid+'.tmp';writeFileSync(staged,String(value));renameSync(staged,file);}
function positivePid(file){
  const raw=readFileSync(file,'utf8').trim();
  if(!/^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw Error('Incomplete or invalid positive PID marker '+file+': '+JSON.stringify(raw));
  return Number(raw);
}
async function waitForPositivePid(file){
  let last='marker absent';
  for(let attempt=0;attempt<150;attempt++){
    if(existsSync(file)){
      try{return positivePid(file);}catch(error){last=error.message;}
    }
    await new Promise(done=>setTimeout(done,10));
  }
  throw Error('PID marker did not publish a positive ID: '+last);
}
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
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'openclaw-loops-poc',version:'1.0.0',devDependencies:{openclaw:'2026.9.5'}}));
  writeFileSync(join(module,'package.json'),JSON.stringify({name:'openclaw',version:'2026.9.5'}));
  writeFileSync(join(module,'openclaw.mjs'),"import {writeFileSync} from 'node:fs'; writeFileSync(new URL('../../output.json',import.meta.url),JSON.stringify({args:process.argv.slice(2),env:process.env}));");
  const port=await freePort();
  writeFileSync(join(profile,'openclaw.json'),JSON.stringify({
    gateway:{mode:'local',bind:'loopback',port,auth:{mode:'token',token:'a'.repeat(64)}},
    discovery:{mdns:{mode:'off'}},browser:{enabled:false},logging:{file:join(profile,'gateway.log')},
    agents:{defaults:{workspace:join(profile,'workspace'),model:{primary:name==='ollama'?'ollama/test:latest':'openai/test',fallbacks:[]}}},
    models:{providers:name==='ollama'?{ollama:{baseUrl:'http://127.0.0.1:11439',api:'ollama',apiKey:'ollama-local',models:[]}}:{openai:{agentRuntime:{id:'codex'}}}},
    ...(name==='codex-test'?{plugins:{entries:{codex:{enabled:false,config:{sessionCatalog:{enabled:false}}}}}}:{}),
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
  it('distinguishes bundled plugin metadata from an enabled disposable install',async()=>{
    const f=await fixture('codex-test'),file=join(f.profile,'openclaw.json');
    const installed=join(f.profile,'state','extensions','codex'),source=join(installed,'dist','index.js');
    mkdirSync(join(installed,'dist'),{recursive:true});writeFileSync(source,'export default {}');
    const config=JSON.parse(readFileSync(file));
    config.plugins.entries.codex.enabled=true;writeFileSync(file,JSON.stringify(config));
    const info={plugin:{id:'codex',packageName:'@openclaw/codex',packageVersion:'2026.9.5',version:'2026.9.5',enabled:true,activated:true,status:'loaded',source},install:{installPath:installed,source:'clawhub',spec:'clawhub:@openclaw/codex@2026.9.5',version:'2026.9.5'}};
    expect(installedProfilePlugin(info,f.profile,'codex')).toBe(true);
    expect(installedProfilePlugin({...info,install:{...info.install,source:'npm',spec:'@openclaw/codex@2026.9.5'}},f.profile,'codex')).toBe(true);
    expect(installedProfilePlugin({...info,install:{...info.install,source:'npm',spec:'@openclaw/codex'}},f.profile,'codex')).toBe(false);
    const accepted=spawnSync(process.execPath,[resolve('scripts/profile-plugin-status.mjs'),'codex'],{cwd:f.root,input:JSON.stringify(info),encoding:'utf8'});
    expect(accepted.status).toBe(0);
    expect(installedProfilePlugin({...info,install:null},f.profile,'codex')).toBe(false);
    expect(installedProfilePlugin({...info,plugin:{...info.plugin,status:'disabled'}},f.profile,'codex')).toBe(false);
    expect(installedProfilePlugin({...info,plugin:{...info.plugin,version:'2026.9.6'}},f.profile,'codex')).toBe(false);
    expect(installedProfilePlugin({...info,install:{...info.install,spec:'clawhub:@openclaw/codex@2026.9.6'}},f.profile,'codex')).toBe(false);
    const foreign=realpathSync(mkdtempSync(join(tmpdir(),'loops-foreign-plugin-')));roots.push(foreign);
    expect(installedProfilePlugin({...info,install:{installPath:foreign}},f.profile,'codex')).toBe(false);
    delete config.plugins.entries.codex;writeFileSync(file,JSON.stringify(config));
    expect(installedProfilePlugin(info,f.profile,'codex')).toBe(false);
    const check=spawnSync(process.execPath,[resolve('scripts/profile-plugin-status.mjs'),'codex'],{cwd:f.root,input:JSON.stringify(info),encoding:'utf8'});
    expect(check.status).toBe(1);
  });
  it('matches the installed Loops plugin to this worktree archive',async()=>{
    const f=await fixture('codex-test'),file=join(f.profile,'openclaw.json');
    const installed=join(f.profile,'state','npm','projects','openclaw-loops-poc','node_modules','openclaw-loops-poc');
    const source=join(installed,'dist','index.js'),archive=join(f.root,'openclaw-loops-poc-1.0.0.tgz');
    mkdirSync(join(installed,'dist'),{recursive:true});writeFileSync(source,'export default {}');writeFileSync(archive,'archive-one');
    const config=JSON.parse(readFileSync(file));config.plugins={entries:{'loops-poc':{enabled:true}}};writeFileSync(file,JSON.stringify(config));
    const info={plugin:{id:'loops-poc',packageName:'openclaw-loops-poc',packageVersion:'1.0.0',version:'1.0.0',enabled:true,activated:true,status:'loaded',source},install:{installPath:installed,source:'npm',spec:'openclaw-loops-poc@1.0.0',version:'1.0.0',npmShasum:createHash('sha1').update('archive-one').digest('hex')}};
    expect(installedProfilePlugin(info,f.profile,'loops-poc')).toBe(true);
    writeFileSync(archive,'archive-two');expect(installedProfilePlugin(info,f.profile,'loops-poc')).toBe(false);
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
    const env=buildEnvironment(f.root,{OPENAI_API_KEY:'private',OPENROUTER_API_KEY:'private',JEV_API_KEY:'private',NODE_OPTIONS:'--require /private/preload.js',NODE_PATH:'/private/modules',HTTPS_PROXY:'http://private-proxy',OPENCLAW_CONFIG_PATH:'/private/real',CODEX_HOME:'/private/codex',PATH:'/usr/bin'});
    expect(env.OPENAI_API_KEY).toBeUndefined();expect(env.OPENCLAW_CONFIG_PATH).toBeUndefined();
    expect(env.CODEX_HOME).toBeUndefined();expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.JEV_API_KEY).toBeUndefined();expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.NODE_PATH).toBeUndefined();expect(env.HTTPS_PROXY).toBeUndefined();
    expect(env.HOME).toContain('build-home');
    expect(env.OPENCLAW_HOME).toBe(env.HOME);expect(env.TMPDIR).toContain('build-home');
    await runOpenClaw(f.root,['plugins','build'],{LOOPS_TEST_OUTPUT:f.output,OPENAI_API_KEY:'private'});
    const result=JSON.parse(readFileSync(f.output));expect(result.args).toEqual(['plugins','build']);
    expect(result.env.OPENAI_API_KEY).toBeUndefined();expect(result.env.OPENCLAW_CONFIG_PATH).toBeUndefined();
  });
  it('passes a dedicated profile and strips provider credentials on a normal invocation',async()=>{
    const f=await fixture();
    await runOpenClaw(f.root,['config','validate'],{LOOPS_TEST_OUTPUT:f.output,OPENAI_API_KEY:'private',ANTHROPIC_AUTH_TOKEN:'private',OPENROUTER_API_KEY:'private',JEV_API_KEY:'private',NODE_OPTIONS:'--require /private/preload.js',NODE_PATH:'/private/modules'});
    const result=JSON.parse(readFileSync(f.output));
    expect(result.env.OPENCLAW_CONFIG_PATH).toBe(join(f.profile,'openclaw.json'));
    expect(result.env.OPENCLAW_STATE_DIR).toBe(join(f.profile,'state'));
    expect(result.env.OPENCLAW_HOME).toBe(join(f.profile,'home'));
    expect(result.env.TMPDIR).toBe(join(f.profile,'tmp'));
    expect(result.env.XDG_CACHE_HOME).toBe(join(f.profile,'cache'));
    expect(result.env.PLAYWRIGHT_BROWSERS_PATH).toBe(join(f.profile,'browser'));
    expect(result.env.HOME).toBe(join(f.profile,'home'));
    expect(result.env.OPENAI_API_KEY).toBeUndefined();expect(result.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(result.env.OPENROUTER_API_KEY).toBeUndefined();expect(result.env.JEV_API_KEY).toBeUndefined();
    expect(result.env.NODE_OPTIONS).toBeUndefined();expect(result.env.NODE_PATH).toBeUndefined();
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
    const before=process.exitCode;
    try{await runOpenClaw(f.root,['gateway','run'],{LOOPS_PROFILE:'codex-test',LOOPS_TEST_OUTPUT:f.output});}
    finally{expect(process.exitCode).toBe(1);process.exitCode=before;}
    expect(JSON.parse(readFileSync(f.output)).args).toEqual(['gateway','run']);
    expect(()=>readFileSync(lease)).toThrow();
    const receipts=readdirSync(join(f.profile,'receipts'));
    expect(receipts).toHaveLength(1);
    const cleanup=JSON.parse(readFileSync(join(f.profile,'receipts',receipts[0])));
    expect(cleanup.leaseRemoved).toBe(true);expect(cleanup.childAlive).toBe(false);
    expect(cleanup.childPid).toBeGreaterThan(0);expect(cleanup.exitCode).toBe(0);
    expect(cleanup.wrapperExitCode).toBe(1);expect(cleanup.supervisionFailure).toBe('readiness-not-achieved');
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
  it('shares one private inference lease despite different inherited temp roots',async()=>{
    const f=await fixture(),before={TMPDIR:process.env.TMPDIR,TMP:process.env.TMP,TEMP:process.env.TEMP};
    const firstTemp=join(f.root,'first-tmp'),secondTemp=join(f.root,'second-tmp');
    mkdirSync(firstTemp);mkdirSync(secondTemp);
    try{
      process.env.TMPDIR=firstTemp;process.env.TMP=firstTemp;process.env.TEMP=firstTemp;
      const globalFirst=globalInferenceLease(),first=globalInferenceLease(f.root);
      process.env.TMPDIR=secondTemp;process.env.TMP=secondTemp;process.env.TEMP=secondTemp;
      expect(globalInferenceLease()).toBe(globalFirst);
      const second=globalInferenceLease(f.root);expect(second).toBe(first);
      const lease=acquireLease(first,'inference-worker',f.root);
      try{expect(()=>acquireLease(second,'inference-worker',f.root)).toThrow(/another live process/);}
      finally{lease.release();}
    }finally{
      for(const [key,value] of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    }
  });
  it('requires a live owned child and ready phase before service reuse',async()=>{
    const f=await fixture(),file=join(f.root,'lease.json'),owner=f.root;
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    try{
      const lease=acquireLease(file,'inference-worker',owner,null,21439);
      lease.markChild(child.pid);
      expect(activeLease(file,'inference-worker',owner,21439)).toBe(false);
      lease.markReady();
      expect(activeLease(file,'inference-worker',owner,21439)).toBe(false);
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
  it('marks readiness only when the owned child holds the selected loopback listener',async()=>{
    const f=await fixture(),port=await freePort(),file=join(f.root,'owned.lease.json');
    const childFile=join(f.root,'listener.mjs');
    writeFileSync(childFile,"import {createServer} from 'node:net'; const server=createServer(); server.listen("+port+",'127.0.0.1'); setTimeout(()=>server.close(),1500);");
    const lease=acquireLease(file,'inference-worker',f.root,join(f.root,'receipts'),port);
    const running=runOwned(process.execPath,[childFile],process.env,lease,port);
    for(let attempt=0;attempt<100&&JSON.parse(readFileSync(file)).phase!=='ready';attempt++)await new Promise(done=>setTimeout(done,20));
    expect(JSON.parse(readFileSync(file)).phase).toBe('ready');
    expect(activeLease(file,'inference-worker',f.root,port)).toBe(true);
    expect(ownedLoopbackListener(process.pid,port)).toBe(false);
    await running;
    expect(existsSync(file)).toBe(false);
  });
  it('rejects a competing listener even while its own child remains alive',async()=>{
    const f=await fixture(),port=await freePort(),file=join(f.root,'competing.lease.json');
    const childFile=join(f.root,'idle.mjs');
    writeFileSync(childFile,'setInterval(()=>{},1000);');
    const foreign=createServer();await new Promise(done=>foreign.listen(port,'127.0.0.1',done));
    const before=process.exitCode;
    try{
      const lease=acquireLease(file,'inference-worker',f.root,join(f.root,'receipts'),port);
      await runOwned(process.execPath,[childFile],process.env,lease,port);
      const receipt=JSON.parse(readFileSync(join(f.root,'receipts',readdirSync(join(f.root,'receipts'))[0])));
      expect(receipt.phase).toBe('starting');expect(receipt.readyAt).toBeUndefined();
      expect(receipt.childAlive).toBe(false);expect(receipt.leaseRemoved).toBe(true);
      expect(existsSync(file)).toBe(false);
    }finally{process.exitCode=before;await new Promise(done=>foreign.close(done));}
  });
  it('forwards SIGTERM only to its child and releases the owned lease',async()=>{
    const f=await fixture(),lease=join(f.root,'term.lease.json'),pidFile=join(f.root,'child.pid');
    const helper=pathToFileURL(resolve('scripts/isolated-runtime.mjs')).href;
    const childFile=join(f.root,'child.mjs'),runner=join(f.root,'runner.mjs');
    writeFileSync(childFile,"import {writeFileSync,renameSync} from 'node:fs'; const file=process.env.LOOPS_TEST_OUTPUT; writeFileSync(file+'.tmp',String(process.pid)); renameSync(file+'.tmp',file); setInterval(()=>{},1000);");
    writeFileSync(runner,'import {runOwned,acquireLease} from '+JSON.stringify(helper)+'; await runOwned(process.execPath,['+JSON.stringify(childFile)+'],{...process.env,LOOPS_TEST_OUTPUT:'+JSON.stringify(pidFile)+'},acquireLease('+JSON.stringify(lease)+',\'gateway\',null,'+JSON.stringify(join(f.root,'receipts'))+'));');
    const parent=spawn(process.execPath,[runner],{stdio:'ignore'});
    try{
      const childPid=await waitForPositivePid(pidFile);
      for(let attempt=0;attempt<100&&JSON.parse(readFileSync(lease,'utf8')).childPid!==childPid;attempt++)await new Promise(done=>setTimeout(done,20));
      expect(JSON.parse(readFileSync(lease,'utf8')).childPid).toBe(childPid);
      parent.kill('SIGTERM');
      await new Promise(done=>parent.once('exit',done));
      expect(existsSync(lease)).toBe(false);
      expect(()=>process.kill(childPid,0)).toThrow();
      const receipt=JSON.parse(readFileSync(join(f.root,'receipts',readdirSync(join(f.root,'receipts'))[0])));
      expect(receipt.childPid).toBe(childPid);expect(receipt.signal).toBe('SIGTERM');expect(receipt.leaseRemoved).toBe(true);
    }finally{if(parent.exitCode===null)parent.kill('SIGKILL');}
  });
  it('cancels before spawn when SIGTERM arrives during startup',async()=>{
    const f=await fixture(),lease=join(f.root,'early.lease.json'),armed=join(f.root,'armed'),ack=join(f.root,'ack'),release=join(f.root,'release'),spawned=join(f.root,'spawned');
    const helper=pathToFileURL(resolve('scripts/isolated-runtime.mjs')).href;
    const childFile=join(f.root,'early-child.mjs'),runner=join(f.root,'early-runner.mjs');
    writeFileSync(childFile,'import {writeFileSync} from \'node:fs\'; writeFileSync('+JSON.stringify(spawned)+',\'spawned\'); setInterval(()=>{},1000);');
    writeFileSync(runner,'import {existsSync,writeFileSync} from \'node:fs\'; import {setTimeout} from \'node:timers/promises\'; import {runOwned,acquireLease} from '+JSON.stringify(helper)+'; process.on(\'SIGTERM\',()=>writeFileSync('+JSON.stringify(ack)+',\'ack\')); await runOwned(process.execPath,['+JSON.stringify(childFile)+'],process.env,()=>acquireLease('+JSON.stringify(lease)+',\'gateway\',null,'+JSON.stringify(join(f.root,'receipts'))+'),null,null,{beforeSpawn:async()=>{writeFileSync('+JSON.stringify(armed)+',\'armed\');while(!existsSync('+JSON.stringify(release)+'))await setTimeout(10);}});');
    const parent=spawn(process.execPath,[runner],{stdio:'ignore'});
    try{
      for(let attempt=0;attempt<100&&!existsSync(armed);attempt++)await new Promise(done=>setTimeout(done,20));
      expect(existsSync(armed)).toBe(true);
      parent.kill('SIGTERM');
      for(let attempt=0;attempt<100&&!existsSync(ack);attempt++)await new Promise(done=>setTimeout(done,20));
      expect(existsSync(ack)).toBe(true);writeFileSync(release,'release');
      const exit=await new Promise((done,reject)=>{const timer=setTimeout(()=>{parent.kill('SIGKILL');reject(Error('Early cancellation did not exit.'));},3000);parent.once('exit',(code,signal)=>{clearTimeout(timer);done({code,signal});});});
      expect(exit.code).toBe(143);expect(exit.signal).toBe(null);
      expect(existsSync(spawned)).toBe(false);expect(existsSync(lease)).toBe(false);
      const receipt=JSON.parse(readFileSync(join(f.root,'receipts',readdirSync(join(f.root,'receipts'))[0])));
      expect(receipt.childPid).toBe(null);expect(receipt.signal).toBe('SIGTERM');expect(receipt.leaseRemoved).toBe(true);
    }finally{if(parent.exitCode===null)parent.kill('SIGKILL');}
  });
  it('releases a lease when cancellation lands during acquisition',async()=>{
    const f=await fixture(),lease=join(f.root,'acquiring.lease.json'),spawned=join(f.root,'acquiring-spawned');
    const helper=pathToFileURL(resolve('scripts/isolated-runtime.mjs')).href;
    const childFile=join(f.root,'acquiring-child.mjs'),runner=join(f.root,'acquiring-runner.mjs');
    writeFileSync(childFile,'import {writeFileSync} from \'node:fs\'; writeFileSync('+JSON.stringify(spawned)+',\'spawned\');');
    writeFileSync(runner,'import {runOwned,acquireLease} from '+JSON.stringify(helper)+'; await runOwned(process.execPath,['+JSON.stringify(childFile)+'],process.env,()=>{const owned=acquireLease('+JSON.stringify(lease)+',\'gateway\',null,'+JSON.stringify(join(f.root,'receipts'))+');process.emit(\'SIGTERM\');return owned;});');
    const result=spawnSync(process.execPath,[runner],{encoding:'utf8',timeout:3000});
    expect(result.status).toBe(143);expect(existsSync(spawned)).toBe(false);expect(existsSync(lease)).toBe(false);
    const receipt=JSON.parse(readFileSync(join(f.root,'receipts',readdirSync(join(f.root,'receipts'))[0])));
    expect(receipt.childPid).toBe(null);expect(receipt.signal).toBe('SIGTERM');expect(receipt.leaseRemoved).toBe(true);
  });
  it('reports the actual SIGKILL exit code after a child ignores SIGTERM',async()=>{
    const f=await fixture(),lease=join(f.root,'kill.lease.json'),pidFile=join(f.root,'kill-child.pid');
    const helper=pathToFileURL(resolve('scripts/isolated-runtime.mjs')).href;
    const childFile=join(f.root,'kill-child.mjs'),runner=join(f.root,'kill-runner.mjs');
    writeFileSync(childFile,'import {writeFileSync,renameSync} from \'node:fs\'; process.on(\'SIGTERM\',()=>{}); const file='+JSON.stringify(pidFile)+'; writeFileSync(file+".tmp",String(process.pid));renameSync(file+".tmp",file); setInterval(()=>{},1000);');
    writeFileSync(runner,'import {runOwned,acquireLease} from '+JSON.stringify(helper)+'; await runOwned(process.execPath,['+JSON.stringify(childFile)+'],process.env,acquireLease('+JSON.stringify(lease)+',\'gateway\',null,'+JSON.stringify(join(f.root,'receipts'))+'));');
    const parent=spawn(process.execPath,[runner],{stdio:'ignore'});
    try{
      const childPid=await waitForPositivePid(pidFile);
      for(let attempt=0;attempt<100&&JSON.parse(readFileSync(lease,'utf8')).childPid!==childPid;attempt++)await new Promise(done=>setTimeout(done,20));
      expect(JSON.parse(readFileSync(lease,'utf8')).childPid).toBe(childPid);
      parent.kill('SIGTERM');
      const exit=await new Promise((done,reject)=>{const timer=setTimeout(()=>{parent.kill('SIGKILL');reject(Error('Forced kill did not exit.'));},9000);parent.once('exit',(code,signal)=>{clearTimeout(timer);done({code,signal});});});
      expect(exit.code).toBe(137);expect(exit.signal).toBe(null);
      expect(()=>process.kill(childPid,0)).toThrow();expect(existsSync(lease)).toBe(false);
      const receipt=JSON.parse(readFileSync(join(f.root,'receipts',readdirSync(join(f.root,'receipts'))[0])));
      expect(receipt.childPid).toBe(childPid);expect(receipt.signal).toBe('SIGKILL');expect(receipt.childAlive).toBe(false);expect(receipt.leaseRemoved).toBe(true);
    }finally{if(parent.exitCode===null)parent.kill('SIGKILL');}
  },12000);
  it('sanitizes inherited host and provider variables',()=>{
    expect(cleanEnvironment({PATH:'/usr/bin',LANG:'en_US.UTF-8',TERM:'xterm',OPENCLAW_STATE_DIR:'/private',OLLAMA_HOST:'remote',OPENROUTER_API_KEY:'secret',JEV_API_KEY:'secret',NODE_OPTIONS:'--require /private/preload.js',NODE_PATH:'/private/modules',HTTPS_PROXY:'http://private-proxy',PUPPETEER_CACHE_DIR:'/private'})).toEqual({PATH:'/usr/bin',LANG:'en_US.UTF-8',TERM:'xterm'});
  });
  it('admits documented CLI shapes and rejects host, auth, and path overrides',async()=>{
    const f=await fixture(),archive=join(f.root,'candidate.tgz');writeFileSync(archive,'fixture');
    expect(admitOpenClawArgs(f.root,['plugins','build'])).toBe('build');
    expect(admitOpenClawArgs(f.root,['plugins','install','npm-pack:'+archive,'--force','--accept-capabilities'])).toBe('runtime');
    expect(admitOpenClawArgs(f.root,['plugins','install','@openclaw/codex@2026.9.5','--accept-capabilities'])).toBe('codex-install');
    expect(admitOpenClawArgs(f.root,['gateway','call','plugins.sessionAction','--params','{}','--json','--timeout','60000'])).toBe('gateway-call');
    expect(admitOpenClawArgs(f.root,['agent','--agent','main','--session-key','synthetic','--message','hello','--json'])).toBe('agent');
    for(const args of [
      ['gateway','run','--bind','lan'],['gateway','run','--auth','none'],['gateway','run','--token','foreign'],
      ['gateway','run','--port=18789'],['config','set','gateway.bind','lan'],
      ['gateway','call','config.set','--params','{}','--json'],
      ['plugins','install','npm-pack:/private/foreign.tgz'],
      ['plugins','install','@openclaw/codex','--accept-capabilities'],
      ['plugins','install','@openclaw/codex@2026.9.6','--accept-capabilities'],
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
      config=>{config.env={OPENROUTER_API_KEY:'private'};},
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
  it('rejects a symlinked global lease namespace',async()=>{
    const f=await fixture(),foreign=realpathSync(mkdtempSync(join(tmpdir(),'loops-foreign-lease-')));roots.push(foreign);
    symlinkSync(foreign,join(f.root,'openclaw-loops-inference-'+process.getuid()));
    expect(()=>globalInferenceLease(f.root)).toThrow(/symlink/);
  });
});

describe('final review bounded profile admission',()=>{
  it('requires the exact disabled Codex catalog before any profile dispatch',async()=>{
    const f=await fixture('codex-test'),file=join(f.profile,'openclaw.json'),safe=JSON.parse(readFileSync(file));
    expect(()=>profileEnvironment(f.root,'codex-test')).not.toThrow();
    for(const edit of [
      config=>{delete config.plugins.entries.codex.config;},
      config=>{config.plugins.entries.codex.config={sessionCatalog:{}};},
      config=>{config.plugins.entries.codex.config={sessionCatalog:{enabled:true}};},
      config=>{config.plugins.entries.codex.config={sessionCatalog:{homes:['/foreign/codex-home']}};},
      config=>{config.plugins.entries.codex.config={sessionCatalog:{enabled:false,homes:[{path:'/foreign/codex-home'}]}};},
      config=>{config.plugins.entries.codex.config={sessionCatalog:{enabled:false},appServer:{command:'/foreign/custom-runtime'}};},
      config=>{config.plugins.entries.codex.config={sessionCatalog:{enabled:false},appServer:{args:['--foreign']}};},
      config=>{config.plugins.entries.codex.config={sessionCatalog:{enabled:false},appServer:{transport:'ws',url:'ws://127.0.0.1:39222'}};},
      config=>{config.plugins.entries.codex.config={sessionCatalog:{enabled:false},appServer:{transport:'unix',socketPath:'/foreign/runtime.sock'}};},
      config=>{config.plugins.entries.codex.config={sessionCatalog:{enabled:false},discovery:{endpoints:[{url:'http://127.0.0.1:39222'}]}};},
      config=>{config.plugins.entries.codex.config={sessionCatalog:{enabled:false},supervision:{command:'/foreign/supervisor'}};},
    ]){
      const config=structuredClone(safe);config.plugins.entries.codex.enabled=true;edit(config);writeFileSync(file,JSON.stringify(config));
      await expect(runOpenClaw(f.root,['plugins','info','codex','--json'],{LOOPS_PROFILE:'codex-test'})).rejects.toThrow(/Codex plugin/);
      expect(existsSync(f.output)).toBe(false);
    }
    writeFileSync(file,JSON.stringify(safe));
    await runOpenClaw(f.root,['config','validate'],{LOOPS_PROFILE:'codex-test'});
    expect(existsSync(f.output)).toBe(true);
  });
  it('initializes the safe Codex config before install and retains it for an installed profile',async()=>{
    const f=await fixture('codex-test'),file=join(f.profile,'openclaw.json');
    rmSync(f.profile,{recursive:true});
    writeFileSync(join(f.root,'openclaw.plugin.json'),JSON.stringify({contracts:{tools:[]}}));
    const init=resolve('scripts/init-codex-profile.mjs');
    const fresh=spawnSync(process.execPath,[init],{cwd:f.root,encoding:'utf8'});
    expect(fresh.status).toBe(0);
    const config=JSON.parse(readFileSync(file));
    expect(config.plugins.entries.codex.config).toEqual({sessionCatalog:{enabled:false}});
    expect(config.browser).toEqual({enabled:false});
    expect(()=>profileEnvironment(f.root,'codex-test')).not.toThrow();
    config.plugins.entries.codex.enabled=true;writeFileSync(file,JSON.stringify(config));
    const installed=spawnSync(process.execPath,[init],{cwd:f.root,encoding:'utf8'});
    expect(installed.status).toBe(0);
    expect(JSON.parse(readFileSync(file)).plugins.entries.codex.config).toEqual({sessionCatalog:{enabled:false}});
  });
  it('rejects browser attachment, import, MCP and launch overrides before dispatch',async()=>{
    const f=await fixture(),file=join(f.profile,'openclaw.json'),safe=JSON.parse(readFileSync(file));
    for(const browser of [
      undefined,{enabled:true},{enabled:false,allowSystemProfileImport:true},
      {enabled:true,profiles:{foreign:{driver:'existing-session',mcpArgs:['--browserUrl','http://127.0.0.1:39222']}}},
      {enabled:true,profiles:{foreign:{driver:'existing-session',mcpArgs:['--autoConnect']}}},
      {enabled:true,profiles:{foreign:{driver:'extension'}}},
      {enabled:true,profiles:{foreign:{attachOnly:true}}},
      {enabled:false,mcpCommand:'/foreign/mcp'},
      {enabled:false,profiles:{foreign:{mcpArgs:['--browserUrl','http://127.0.0.1:39222']}}},
      {enabled:false,executablePath:'/foreign/browser'},
      {enabled:false,profiles:{foreign:{userDataDir:'/foreign/browser-data'}}},
    ]){
      const config=structuredClone(safe);if(browser===undefined)delete config.browser;else config.browser=browser;
      writeFileSync(file,JSON.stringify(config));
      await expect(runOpenClaw(f.root,['config','validate'])).rejects.toThrow(/browser/);
      expect(existsSync(f.output)).toBe(false);
    }
    writeFileSync(file,JSON.stringify(safe));expect(()=>profileEnvironment(f.root)).not.toThrow();
  });
  it('rejects explicit default and entry sandbox execution routes before dispatch',async()=>{
    const f=await fixture(),file=join(f.profile,'openclaw.json'),safe=JSON.parse(readFileSync(file));
    for(const sandbox of [
      {mode:'all',workspaceRoot:'/foreign/workspace'},
      {mode:'all',docker:{binds:['/foreign:/foreign:rw'],env:{SECRET:'fixture'},setupCommand:'cat /foreign'}},
      {mode:'all',ssh:{target:'foreign-host',identityFile:'/foreign/key',command:'ssh'}},
    ])for(const location of ['defaults','entry']){
      const config=structuredClone(safe);
      if(location==='defaults')config.agents.defaults.sandbox=sandbox;
      else config.agents.entries={worker:{sandbox}};
      writeFileSync(file,JSON.stringify(config));
      await expect(runOpenClaw(f.root,['config','validate'])).rejects.toThrow(/sandbox/);
      expect(existsSync(f.output)).toBe(false);
    }
    writeFileSync(file,JSON.stringify(safe));expect(()=>profileEnvironment(f.root)).not.toThrow();
  });
});

describe('round-two isolation boundaries',()=>{
  it('waits through delayed empty PID publication and rejects PID zero',async()=>{
    const f=await fixture(),marker=join(f.root,'delayed.pid');
    writeFileSync(marker,'');
    expect(()=>positivePid(marker)).toThrow(/Incomplete or invalid positive PID/);
    writeFileSync(marker,'0');
    expect(()=>positivePid(marker)).toThrow(/Incomplete or invalid positive PID/);
    writeFileSync(marker,'');
    const timer=setTimeout(()=>publishMarker(marker,34567),40);
    try{expect(await waitForPositivePid(marker)).toBe(34567);}
    finally{clearTimeout(timer);}
  });
  it('validates canonical agent entries and effective paths and model routes',async()=>{
    const f=await fixture(),file=join(f.profile,'openclaw.json'),original=JSON.parse(readFileSync(file));
    const foreign=realpathSync(mkdtempSync(join(tmpdir(),'loops-foreign-agent-')));roots.push(foreign);
    const valid=structuredClone(original);
    valid.agents.entries={main:{workspace:join(f.profile,'workspace','main'),cwd:join(f.profile,'workspace','main'),agentDir:join(f.profile,'state','agents','main','agent'),model:{primary:'ollama/test:latest',fallbacks:['ollama/backup:latest']}}};
    writeFileSync(file,JSON.stringify(valid));
    expect(()=>profileEnvironment(f.root)).not.toThrow();
    for(const edit of [
      config=>{config.agents.entries.main.workspace=join(foreign,'workspace');},
      config=>{config.agents.entries.main.cwd=join(foreign,'cwd');},
      config=>{config.agents.entries.main.agentDir=join(foreign,'auth');},
      config=>{config.agents.entries.main.model='openai/unapproved';},
      config=>{config.agents.entries.main.model.fallbacks=['openai/unapproved'];},
      config=>{config.agents.defaults.cwd=join(foreign,'cwd');},
      config=>{config.agents.defaults.modelPolicy={allow:['openai/unapproved']};},
    ]){
      const config=structuredClone(valid);edit(config);writeFileSync(file,JSON.stringify(config));
      await expect(runOpenClaw(f.root,['config','validate'])).rejects.toThrow();
      expect(existsSync(f.output)).toBe(false);
    }
    symlinkSync(foreign,join(f.profile,'workspace','redirect'));
    const redirected=structuredClone(valid);
    redirected.agents.entries.main.workspace=join(f.profile,'workspace','redirect','nested');
    writeFileSync(file,JSON.stringify(redirected));
    expect(()=>profileEnvironment(f.root)).toThrow(/redirects outside/);
    expect(existsSync(join(foreign,'nested'))).toBe(false);
  });
  it('rejects explicit session-store paths without touching foreign locations',async()=>{
    const f=await fixture(),file=join(f.profile,'openclaw.json'),original=JSON.parse(readFileSync(file));
    const foreign=realpathSync(mkdtempSync(join(tmpdir(),'loops-foreign-store-')));roots.push(foreign);
    symlinkSync(foreign,join(f.profile,'state-link'));
    for(const store of [join(foreign,'sessions.json'),'../foreign/sessions.json','{agentId}/sessions.json',join(f.profile,'state-link','sessions.json'),join(f.profile,'state','sessions.json')]){
      const config=structuredClone(original);config.session={store};writeFileSync(file,JSON.stringify(config));
      await expect(runOpenClaw(f.root,['config','validate'])).rejects.toThrow(/session-store/);
      expect(existsSync(f.output)).toBe(false);
      expect(existsSync(join(foreign,'sessions.json'))).toBe(false);
    }
    writeFileSync(file,JSON.stringify(original));expect(()=>profileEnvironment(f.root)).not.toThrow();
  });
  it('strips Node preloads before each shell wrapper starts any Node interpreter',async()=>{
    const f=await fixture(),scripts=join(f.root,'scripts'),preload=join(f.root,'preload.mjs'),marker=join(f.root,'preload-ran');
    mkdirSync(scripts);mkdirSync(join(f.root,'.dev-profile','codex-test'),{recursive:true});
    writeFileSync(join(f.root,'.dev-profile','codex-test','openclaw.json'),'{}');
    writeFileSync(preload,'import {writeFileSync} from "node:fs"; writeFileSync('+JSON.stringify(marker)+',"ran");');
    for(const name of ['dev','ollama','codex']){
      copyFileSync(resolve('scripts',name+'.sh'),join(scripts,name+'.sh'));
      for(const command of name==='codex'?['setup','copy-secret','review-unadmitted-command']:['review-unadmitted-command']){
        const result=spawnSync('bash',['scripts/'+name+'.sh',command],{cwd:f.root,env:{...process.env,LOOPS_NODE_BIN:process.execPath,NODE_OPTIONS:'--import='+preload,NODE_PATH:join(f.root,'injected')},encoding:'utf8'});
        expect(result.status).not.toBe(0);
        expect(existsSync(marker)).toBe(false);
      }
    }
  });
  it('preserves readiness and guard failures when the child handles TERM and exits zero',async()=>{
    const f=await fixture(),helper=pathToFileURL(resolve('scripts/isolated-runtime.mjs')).href;
    const childFile=join(f.root,'term-zero.mjs'),runner=join(f.root,'supervisor.mjs'),port=await freePort();
    writeFileSync(childFile,"process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{},1000);");
    const foreign=createServer();await new Promise(done=>foreign.listen(port,'127.0.0.1',done));
    try{
      for(const [mode,expected] of [['readiness','readiness-failed'],['guard-false','authority-guard-failed'],['guard-throw','authority-guard-error'],['success',null]]){
        const lease=join(f.root,mode+'.lease.json'),receipts=join(f.root,mode+'-receipts');
        const guard=mode==='guard-false'?'()=>false':mode==='guard-throw'?'()=>{throw Error("fixture");}':'null';
        const ready=mode==='readiness'?String(port):'null';
        const binary=mode==='success'?join(f.root,'success.mjs'):childFile;
        if(mode==='success')writeFileSync(binary,'process.exit(0);');
        writeFileSync(runner,'import {runOwned,acquireLease} from '+JSON.stringify(helper)+'; await runOwned(process.execPath,['+JSON.stringify(binary)+'],process.env,()=>acquireLease('+JSON.stringify(lease)+',"gateway",null,'+JSON.stringify(receipts)+'),'+ready+','+guard+');');
        const finished=spawnSync(process.execPath,[runner],{encoding:'utf8',timeout:7000});
        expect(finished.status).toBe(expected?1:0);
        expect(existsSync(lease)).toBe(false);
        const saved=JSON.parse(readFileSync(join(receipts,readdirSync(receipts)[0])));
        expect(saved.exitCode).toBe(0);expect(saved.signal).toBe(null);
        expect(saved.wrapperExitCode).toBe(expected?1:0);
        expect(saved.supervisionFailure).toBe(expected);
        expect(saved.groupSettled).toBe(true);expect(saved.leaseRemoved).toBe(true);
      }
    }finally{await new Promise(done=>foreign.close(done));}
  },30000);
  it('settles an owned descendant before releasing capacity while preserving an unrelated process',async()=>{
    const f=await fixture(),helper=pathToFileURL(resolve('scripts/isolated-runtime.mjs')).href;
    const grandchild=join(f.root,'grandchild.mjs'),leader=join(f.root,'leader.mjs'),runner=join(f.root,'runner.mjs');
    const pidFile=join(f.root,'descendant.pid'),lease=join(f.root,'group.lease.json'),receipts=join(f.root,'group-receipts');
    writeFileSync(grandchild,'import {writeFileSync,renameSync} from "node:fs"; const file='+JSON.stringify(pidFile)+'; writeFileSync(file+".tmp",String(process.pid));renameSync(file+".tmp",file); setInterval(()=>{},1000); setTimeout(()=>process.exit(0),10000);');
    writeFileSync(leader,'import {spawn} from "node:child_process"; import {existsSync} from "node:fs"; spawn(process.execPath,['+JSON.stringify(grandchild)+'],{stdio:"ignore"}); const timer=setInterval(()=>{if(existsSync('+JSON.stringify(pidFile)+')){clearInterval(timer);process.exit(0);}},10);');
    writeFileSync(runner,'import {runOwned,acquireLease} from '+JSON.stringify(helper)+'; await runOwned(process.execPath,['+JSON.stringify(leader)+'],process.env,()=>acquireLease('+JSON.stringify(lease)+',"inference-worker",null,'+JSON.stringify(receipts)+'));');
    const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    try{
      const finished=spawnSync(process.execPath,[runner],{encoding:'utf8',timeout:7000});
      expect(finished.status).toBe(0);
      const descendantPid=await waitForPositivePid(pidFile);
      expect(()=>process.kill(descendantPid,0)).toThrow();
      expect(()=>process.kill(unrelated.pid,0)).not.toThrow();
      expect(existsSync(lease)).toBe(false);
      const saved=JSON.parse(readFileSync(join(receipts,readdirSync(receipts)[0])));
      expect(saved.childPid).toBeGreaterThan(0);expect(saved.childPid).not.toBe(descendantPid);
      expect(()=>process.kill(-saved.childPid,0)).toThrow();
      expect(saved.groupSettled).toBe(true);expect(saved.leaseRemoved).toBe(true);
      const next=acquireLease(lease,'inference-worker');next.release();
    }finally{unrelated.kill('SIGTERM');}
  },12000);
  it('retains the lease when process-group settlement cannot be verified',async()=>{
    const f=await fixture(),helper=pathToFileURL(resolve('scripts/isolated-runtime.mjs')).href;
    const child=join(f.root,'short.mjs'),runner=join(f.root,'uncertain.mjs'),file=join(f.root,'uncertain.lease.json'),receipts=join(f.root,'uncertain-receipts');
    writeFileSync(child,'process.exit(0);');
    writeFileSync(runner,'import {runOwned,acquireLease} from '+JSON.stringify(helper)+'; const kill=process.kill; process.kill=(pid,signal)=>{if(pid<0){const error=Error("unverified");error.code="EPERM";throw error;}return kill(pid,signal);}; try{await runOwned(process.execPath,['+JSON.stringify(child)+'],process.env,()=>acquireLease('+JSON.stringify(file)+',"inference-worker",null,'+JSON.stringify(receipts)+'));}catch{process.exitCode=1;}');
    const finished=spawnSync(process.execPath,[runner],{encoding:'utf8',timeout:7000});
    expect(finished.status).toBe(1);expect(existsSync(file)).toBe(true);
    const saved=JSON.parse(readFileSync(join(receipts,readdirSync(receipts)[0])));
    expect(saved.exitCode).toBe(0);expect(saved.groupSettled).toBe(false);
    expect(saved.leaseRemoved).toBe(false);expect(saved.wrapperExitCode).toBe(1);
    expect(saved.supervisionFailure).toBe('process-group-unverified');
    const recovered=acquireLease(file,'inference-worker');recovered.release();
  });
  it('serializes two stale-lease recoverers and preserves the one live winner',async()=>{
    const f=await fixture(),helper=pathToFileURL(resolve('scripts/isolated-runtime.mjs')).href;
    const file=join(f.root,'contended.lease.json'),go=join(f.root,'go'),stop=join(f.root,'stop'),runner=join(f.root,'contender.mjs');
    writeFileSync(file,JSON.stringify({id:'stale',parentPid:99999999,childPid:null}));mkdirSync(file+'.gate',{mode:0o700});
    writeFileSync(runner,'import {existsSync,writeFileSync,renameSync} from "node:fs"; import {setTimeout} from "node:timers/promises"; import {acquireLease} from '+JSON.stringify(helper)+'; const [file,go,stop,out,receipts]=process.argv.slice(2); const publish=(path,value)=>{const tmp=path+"."+process.pid+".tmp";writeFileSync(tmp,value);renameSync(tmp,path);}; while(!existsSync(go))await setTimeout(5); publish(out+".ready","ready"); try{const lease=acquireLease(file,"inference-worker",null,receipts);publish(out,"won:"+process.pid);while(!existsSync(stop))await setTimeout(10);lease.release();}catch(error){publish(out,"lost:"+error.message);}');
    const outputs=[join(f.root,'one'),join(f.root,'two')];
    const receipts=join(f.root,'contender-receipts');
    const contenders=outputs.map(out=>spawn(process.execPath,[runner,file,go,stop,out,receipts],{stdio:'ignore'}));
    try{
      publishMarker(go,'go');
      for(let attempt=0;attempt<150&&!outputs.every(out=>existsSync(out+'.ready')&&readFileSync(out+'.ready','utf8')==='ready');attempt++)await new Promise(done=>setTimeout(done,5));
      expect(outputs.every(out=>existsSync(out+'.ready')&&readFileSync(out+'.ready','utf8')==='ready')).toBe(true);
      expect(JSON.parse(readFileSync(file)).id).toBe('stale');
      rmdirSync(file+'.gate');
      for(let attempt=0;attempt<200&&!outputs.every(existsSync);attempt++)await new Promise(done=>setTimeout(done,10));
      expect(outputs.every(existsSync)).toBe(true);
      const results=outputs.map(out=>readFileSync(out,'utf8'));
      expect(results.filter(value=>value.startsWith('won:'))).toHaveLength(1);
      expect(results.filter(value=>value.startsWith('lost:'))).toHaveLength(1);
      const ownerText=results.find(value=>value.startsWith('won:')).slice(4);
      expect(ownerText).toMatch(/^[1-9]\d*$/);
      const owner=Number(ownerText);expect(Number.isSafeInteger(owner)).toBe(true);
      expect(JSON.parse(readFileSync(file)).parentPid).toBe(owner);
      publishMarker(stop,'stop');
      await Promise.all(contenders.map(child=>child.exitCode!==null?Promise.resolve():new Promise(done=>child.once('exit',done))));
      expect(existsSync(file)).toBe(false);
      const saved=JSON.parse(readFileSync(join(receipts,readdirSync(receipts)[0])));
      expect(saved.parentPid).toBe(owner);expect(saved.leaseRemoved).toBe(true);
    }finally{publishMarker(stop,'stop');if(existsSync(file+'.gate'))rmdirSync(file+'.gate');for(const child of contenders)if(child.exitCode===null)child.kill('SIGKILL');}
  },10000);
});
