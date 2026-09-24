import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {createConnection} from 'node:net';
import {tmpdir} from 'node:os';
import {dirname,isAbsolute,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const supported=new Set(['v24.16.0','v26.1.0']);
const secret=/^(OPENCLAW_|OLLAMA_|OPENAI_|ANTHROPIC_|GOOGLE_|GEMINI_|AZURE_|AWS_|CODEX_|GROQ_|MISTRAL_|TOGETHER_|FIREWORKS_|DEEPSEEK_|XAI_|HF_|HUGGINGFACE_)/i;
const controlled=new Set(['HOME','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','PLAYWRIGHT_BROWSERS_PATH','CHROME_USER_DATA_DIR','PUPPETEER_CACHE_DIR','BROWSER']);
const canonical=path=>realpathSync(resolve(path));
const privateDir=path=>mkdirSync(path,{recursive:true,mode:0o700});
const inside=(path,parent)=>path.startsWith(parent+sep);
const live=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const existsEntry=path=>{try{lstatSync(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
function developmentBase(project){
  const base=join(project,'.dev-profile');privateDir(base);
  assert.equal(canonical(base),base,'Development directory must not redirect outside this checkout.');
  return base;
}
export function assertSetupLocation(root,name){
  assert(['ollama','codex-test'].includes(name),'Choose a supported development profile.');
  const project=canonical(root),base=developmentBase(project),profile=name==='ollama'?base:join(base,name);
  for(const path of [profile,join(profile,'openclaw.json'),join(profile,'workspace')]){
    if(existsEntry(path))assert.equal(canonical(path),path,'Setup path must not redirect outside this checkout.');
  }
  return profile;
}

export function assertNode(version=process.version){
  assert(supported.has(version),'Use exactly Node 24.16.0 or 26.1.0; got '+version+'.');
}
export function installedHost(root){
  const project=canonical(root),pkg=JSON.parse(readFileSync(join(project,'package.json'),'utf8'));
  const location=join(project,'node_modules','openclaw');
  assert(existsSync(location),'Project OpenClaw is missing; run npm ci in this checkout.');
  const moduleRoot=canonical(location);
  assert(inside(moduleRoot,join(project,'node_modules')),'OpenClaw resolves outside this checkout.');
  const manifest=JSON.parse(readFileSync(join(moduleRoot,'package.json'),'utf8'));
  assert.equal(manifest.name,'openclaw');
  assert.equal(manifest.version,pkg.devDependencies.openclaw,'Installed OpenClaw differs from the pinned version.');
  const cli=canonical(join(moduleRoot,'openclaw.mjs'));
  assert(inside(cli,moduleRoot),'OpenClaw CLI resolves outside the pinned package.');
  return cli;
}
export function cleanEnvironment(source=process.env){
  return Object.fromEntries(Object.entries(source).filter(([key])=>!secret.test(key)&&!controlled.has(key)));
}
function checkInherited(source,expected){
  for(const [key,path] of Object.entries(expected)){
    if(source[key]!==undefined&&resolve(source[key])!==path)throw Error(key+' points outside the isolated profile.');
  }
}
export function profileEnvironment(root,name='ollama',source=process.env){
  assert(['ollama','codex-test'].includes(name),'Choose an explicit supported development profile.');
  const project=canonical(root),base=developmentBase(project),profile=name==='ollama'?base:join(base,name);
  assert(existsSync(profile),'Development profile is missing; initialize it first.');
  assert.equal(canonical(profile),profile,'Profile must be a real directory inside this checkout.');
  const configPath=join(profile,'openclaw.json');
  assert(existsSync(configPath),'Development profile config is missing.');
  assert.equal(canonical(configPath),configPath,'Development profile config must not be a symlink.');
  const config=JSON.parse(readFileSync(configPath,'utf8'));
  const state=join(profile,'state'),workspace=join(profile,'workspace'),cache=join(profile,'cache'),browser=join(profile,'browser'),home=join(profile,'home');
  assert.equal(resolve(project,config.agents?.defaults?.workspace),workspace,'Workspace must remain in this profile.');
  assert.equal(config.gateway?.mode,'local');
  assert.equal(config.gateway?.bind,'loopback');
  assert(config.gateway?.auth?.mode==='token'&&typeof config.gateway.auth.token==='string'&&config.gateway.auth.token.length>=32,'Gateway needs its own token.');
  const port=config.gateway?.port;
  assert(Number.isInteger(port)&&port>=1024&&port<=65535,'Gateway needs a dedicated nonprivileged port.');
  assert.equal(config.browser?.enabled,false,'Browser integration must be disabled in this profile.');
  if(config.logging?.file)assert.equal(resolve(project,config.logging.file),join(profile,'gateway.log'),'Gateway log must remain in this profile.');
  for(const dir of [state,workspace,cache,browser,home]){
    privateDir(dir);assert.equal(canonical(dir),dir,'Profile path escapes this checkout.');
  }
  const expected={OPENCLAW_CONFIG_PATH:configPath,OPENCLAW_STATE_DIR:state,XDG_CACHE_HOME:cache,PLAYWRIGHT_BROWSERS_PATH:browser,CHROME_USER_DATA_DIR:browser};
  checkInherited(source,expected);
  const env={...cleanEnvironment(source),...expected,HOME:home,XDG_CONFIG_HOME:join(profile,'xdg-config'),XDG_DATA_HOME:join(profile,'xdg-data'),OPENCLAW_LOG_LEVEL:'info'};
  privateDir(env.XDG_CONFIG_HOME);privateDir(env.XDG_DATA_HOME);
  return {profile,config,port,env};
}
export function buildEnvironment(root,source=process.env){
  const home=join(developmentBase(canonical(root)),'build-home'),cache=join(home,'cache');
  privateDir(cache);
  assert.equal(canonical(home),home,'Build home must remain in this checkout.');
  return {...cleanEnvironment(source),HOME:home,XDG_CONFIG_HOME:home,XDG_DATA_HOME:home,XDG_CACHE_HOME:cache};
}
export function portOccupied(port,host='127.0.0.1'){
  return new Promise(done=>{
    const socket=createConnection({host,port});
    socket.once('connect',()=>{socket.destroy();done(true);});
    socket.once('error',error=>{socket.destroy();done(error.code!=='ECONNREFUSED');});
    socket.setTimeout(1000,()=>{socket.destroy();done(true);});
  });
}
export function acquireLease(file,kind,owner=null){
  privateDir(dirname(file));
  const receipt={kind,owner,pid:process.pid,id:randomUUID(),startedAt:new Date().toISOString()};
  for(let attempt=0;attempt<2;attempt++){
    try{
      writeFileSync(file,JSON.stringify(receipt)+'\n',{flag:'wx',mode:0o600});
      return ()=>{
        try{if(JSON.parse(readFileSync(file,'utf8')).id===receipt.id)rmSync(file);}catch{/* already removed or changed owner */}
      };
    }catch(error){
      if(error.code!=='EEXIST')throw error;
      let current;
      try{current=JSON.parse(readFileSync(file,'utf8'));}catch(parseError){throw Error(kind+' lease is unreadable; inspect it before retrying.',{cause:parseError});}
      if(!Number.isInteger(current.pid)||live(current.pid))throw Error(kind+' is owned by another live process.',{cause:error});
      if(JSON.parse(readFileSync(file,'utf8')).id!==current.id)continue;
      rmSync(file);
    }
  }
  throw Error('Unable to acquire '+kind+' lease.');
}
function activeLease(file,kind,owner){
  try{const receipt=JSON.parse(readFileSync(file,'utf8'));return receipt.kind===kind&&receipt.owner===owner&&Number.isInteger(receipt.pid)&&live(receipt.pid);}catch{return false;}
}
export async function runOwned(binary,args,env,release){
  let child;
  const forward=signal=>{if(child&&!child.killed)child.kill(signal);};
  try{
    child=spawn(binary,args,{stdio:'inherit',env});
    process.on('SIGINT',forward);process.on('SIGTERM',forward);
    const result=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>done({code,signal}));});
    process.exitCode=result.signal?128+(result.signal==='SIGINT'?2:15):result.code??1;
  }finally{
    process.off('SIGINT',forward);process.off('SIGTERM',forward);
    release?.();
    if(release)console.error('Owned resource stopped and lease released.');
  }
}
export async function runOpenClaw(root,args,source=process.env){
  assertNode();const cli=installedHost(root);
  assert(args.length>0,'Choose an OpenClaw command.');
  assert(!args.some(arg=>['--profile','--config','--state-dir','--port','--dev'].some(flag=>arg===flag||arg.startsWith(flag+'='))),'Profile and port overrides are forbidden.');
  const build=args.length===2&&args[0]==='plugins'&&args[1]==='build';
  if(build)return runOwned(process.execPath,[cli,...args],buildEnvironment(root,source));
  const profile=profileEnvironment(root,source.LOOPS_PROFILE??'ollama',source);
  const lease=join(profile.profile,'gateway.lease.json'),gatewayRun=args[0]==='gateway'&&args[1]==='run';
  if(gatewayRun){
    assert(!(await portOccupied(profile.port)),'Gateway port is occupied by an existing service.');
    return runOwned(process.execPath,[cli,...args],profile.env,acquireLease(lease,'gateway',profile.profile));
  }
  if(await portOccupied(profile.port))assert(activeLease(lease,'gateway',profile.profile),'Gateway port is occupied by an unowned service.');
  return runOwned(process.execPath,[cli,...args],profile.env);
}
export async function runOllama(root,args,source=process.env){
  assertNode();assert(args.length>0,'Choose an Ollama command.');
  const project=canonical(root),binary=source.LOOPS_OLLAMA_BIN;
  assert(binary&&isAbsolute(binary)&&existsSync(binary)&&statSync(binary).isFile(),'Set LOOPS_OLLAMA_BIN to an explicit Ollama executable.');
  const executable=canonical(binary),models=join(developmentBase(project),'ollama-models');
  assert(!executable.includes(sep+'.openclaw'+sep),'Personal OpenClaw paths are forbidden.');
  privateDir(models);assert.equal(canonical(models),models);
  if(source.OLLAMA_MODELS!==undefined&&resolve(source.OLLAMA_MODELS)!==models)throw Error('OLLAMA_MODELS points outside this checkout.');
  if(source.OLLAMA_HOST!==undefined&&source.OLLAMA_HOST!=='127.0.0.1:11439')throw Error('OLLAMA_HOST points outside the dedicated service.');
  const lease=join(tmpdir(),'openclaw-loops-inference-'+(process.getuid?.()??'local')+'.lease.json');
  const serve=args[0]==='serve';
  if(serve)assert(!(await portOccupied(11439)),'Inference port is occupied by an existing provider daemon.');
  else assert(activeLease(lease,'inference-worker',project),'Start the owned isolated inference worker first.');
  const home=join(project,'.dev-profile','ollama-home');privateDir(home);
  const env={...cleanEnvironment(source),OLLAMA_HOST:'127.0.0.1:11439',OLLAMA_MODELS:models,OLLAMA_CONTEXT_LENGTH:'32768',OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',OLLAMA_FLASH_ATTENTION:'1',OLLAMA_KV_CACHE_TYPE:'q8_0',OLLAMA_NO_CLOUD:'1',HOME:home};
  return runOwned(executable,args,env,serve?acquireLease(lease,'inference-worker',project):undefined);
}
if(fileURLToPath(import.meta.url)===resolve(process.argv[1]??'')){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const [mode,...args]=process.argv.slice(2);
  try{
    if(mode==='openclaw')await runOpenClaw(root,args);
    else if(mode==='ollama')await runOllama(root,args);
    else throw Error('Use openclaw or ollama mode.');
  }catch(error){console.error('Isolated runtime refused dispatch: '+error.message);process.exitCode=1;}
}
