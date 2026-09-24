import {afterEach,describe,it,expect} from 'vitest';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {acquireLease,assertNode,assertSetupLocation,buildEnvironment,cleanEnvironment,installedHost,portOccupied,profileEnvironment,runOpenClaw} from '../scripts/isolated-runtime.mjs';

const roots=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
async function freePort(){
  const server=createServer();
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const port=server.address().port;
  await new Promise(done=>server.close(done));
  return port;
}
async function fixture(){
  const root=realpathSync(mkdtempSync(join(tmpdir(),'loops-isolated-')));roots.push(root);
  const module=join(root,'node_modules','openclaw'),profile=join(root,'.dev-profile');
  mkdirSync(module,{recursive:true});mkdirSync(join(profile,'workspace'),{recursive:true});
  writeFileSync(join(root,'package.json'),JSON.stringify({devDependencies:{openclaw:'2026.9.5'}}));
  writeFileSync(join(module,'package.json'),JSON.stringify({name:'openclaw',version:'2026.9.5'}));
  writeFileSync(join(module,'openclaw.mjs'),"import {writeFileSync} from 'node:fs'; writeFileSync(process.env.LOOPS_TEST_OUTPUT,JSON.stringify({args:process.argv.slice(2),env:process.env}));");
  const port=await freePort();
  writeFileSync(join(profile,'openclaw.json'),JSON.stringify({
    gateway:{mode:'local',bind:'loopback',port,auth:{mode:'token',token:'a'.repeat(64)}},
    browser:{enabled:false},logging:{file:join(profile,'gateway.log')},
    agents:{defaults:{workspace:join(profile,'workspace')}},
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
  it('builds with no runtime profile and removes inherited provider credentials',async()=>{
    const f=await fixture();rmSync(f.profile,{recursive:true});
    const env=buildEnvironment(f.root,{OPENAI_API_KEY:'private',OPENCLAW_CONFIG_PATH:'/private/real',CODEX_HOME:'/private/codex',PATH:'/usr/bin'});
    expect(env.OPENAI_API_KEY).toBeUndefined();expect(env.OPENCLAW_CONFIG_PATH).toBeUndefined();
    expect(env.CODEX_HOME).toBeUndefined();expect(env.HOME).toContain('build-home');
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
    expect(result.env.XDG_CACHE_HOME).toBe(join(f.profile,'cache'));
    expect(result.env.PLAYWRIGHT_BROWSERS_PATH).toBe(join(f.profile,'browser'));
    expect(result.env.HOME).toBe(join(f.profile,'home'));
    expect(result.env.OPENAI_API_KEY).toBeUndefined();expect(result.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });
  it('rejects foreign profile paths and malformed workspace before dispatch',async()=>{
    const f=await fixture();
    expect(()=>profileEnvironment(f.root,'ollama',{OPENCLAW_CONFIG_PATH:'/private/real/openclaw.json'})).toThrow(/outside/);
    expect(()=>profileEnvironment(f.root,'ollama',{OPENCLAW_STATE_DIR:'/private/real/state'})).toThrow(/outside/);
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
    const f=await fixture();
    const server=createServer();await new Promise(done=>server.listen(f.port,'127.0.0.1',done));
    try{
      expect(await portOccupied(f.port)).toBe(true);
      await expect(runOpenClaw(f.root,['gateway','run'],{LOOPS_TEST_OUTPUT:f.output})).rejects.toThrow(/occupied/);
      await expect(runOpenClaw(f.root,['gateway','run','--port','9999'],{LOOPS_TEST_OUTPUT:f.output})).rejects.toThrow(/overrides/);
      expect(()=>readFileSync(f.output)).toThrow();
    }finally{await new Promise(done=>server.close(done));}
  });
  it('releases its Gateway lease after the owned child exits',async()=>{
    const f=await fixture(),lease=join(f.profile,'gateway.lease.json');
    await runOpenClaw(f.root,['gateway','run'],{LOOPS_TEST_OUTPUT:f.output});
    expect(JSON.parse(readFileSync(f.output)).args).toEqual(['gateway','run']);
    expect(()=>readFileSync(lease)).toThrow();
  });
  it('allows only one live lease and removes only its own receipt',async()=>{
    const f=await fixture(),file=join(f.root,'lease.json');
    const release=acquireLease(file,'inference-worker');
    expect(()=>acquireLease(file,'inference-worker')).toThrow(/another live process/);
    release();expect(()=>readFileSync(file)).toThrow();
    const next=acquireLease(file,'inference-worker');next();
    expect(()=>readFileSync(file)).toThrow();
  });
  it('forwards SIGTERM only to its child and releases the owned lease',async()=>{
    const f=await fixture(),lease=join(f.root,'term.lease.json'),pidFile=join(f.root,'child.pid');
    const helper=pathToFileURL(resolve('scripts/isolated-runtime.mjs')).href;
    const childFile=join(f.root,'child.mjs'),runner=join(f.root,'runner.mjs');
    writeFileSync(childFile,"import {writeFileSync} from 'node:fs'; writeFileSync(process.env.LOOPS_TEST_OUTPUT,String(process.pid)); setInterval(()=>{},1000);");
    writeFileSync(runner,'import {runOwned,acquireLease} from '+JSON.stringify(helper)+'; await runOwned(process.execPath,['+JSON.stringify(childFile)+'],{...process.env,LOOPS_TEST_OUTPUT:'+JSON.stringify(pidFile)+'},acquireLease('+JSON.stringify(lease)+',\'gateway\'));');
    const parent=spawn(process.execPath,[runner],{stdio:'ignore'});
    try{
      for(let attempt=0;attempt<100&&!existsSync(pidFile);attempt++)await new Promise(done=>setTimeout(done,20));
      expect(existsSync(pidFile)).toBe(true);expect(existsSync(lease)).toBe(true);
      const childPid=Number(readFileSync(pidFile,'utf8'));
      parent.kill('SIGTERM');
      await new Promise(done=>parent.once('exit',done));
      expect(existsSync(lease)).toBe(false);
      expect(()=>process.kill(childPid,0)).toThrow();
    }finally{if(parent.exitCode===null)parent.kill('SIGKILL');}
  });
  it('sanitizes inherited host and provider variables',()=>{
    expect(cleanEnvironment({PATH:'/usr/bin',OPENCLAW_STATE_DIR:'/private',OLLAMA_HOST:'remote',GOOGLE_API_KEY:'secret',OPENAI_ORG_ID:'private',AWS_SECRET_ACCESS_KEY:'secret',PUPPETEER_CACHE_DIR:'/private'})).toEqual({PATH:'/usr/bin'});
  });
});
