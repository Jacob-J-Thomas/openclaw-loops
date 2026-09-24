import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,renameSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {createConnection} from 'node:net';
import {tmpdir} from 'node:os';
import {setInterval,clearInterval,setTimeout,clearTimeout} from 'node:timers';
import {dirname,isAbsolute,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const supported=new Set(['v24.16.0','v26.1.0']);
const secret=/^(OPENCLAW_|OLLAMA_|OPENAI_|ANTHROPIC_|GOOGLE_|GEMINI_|AZURE_|AWS_|CODEX_|GROQ_|MISTRAL_|TOGETHER_|FIREWORKS_|DEEPSEEK_|XAI_|HF_|HUGGINGFACE_)/i;
const controlled=new Set(['HOME','TMPDIR','TMP','TEMP','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','PLAYWRIGHT_BROWSERS_PATH','CHROME_USER_DATA_DIR','PUPPETEER_CACHE_DIR','BROWSER']);
const canonical=path=>realpathSync(resolve(path));
const privateDir=path=>mkdirSync(path,{recursive:true,mode:0o700});
const inside=(path,parent)=>path.startsWith(parent+sep);
const live=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const existsEntry=path=>{try{lstatSync(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
export function ollamaPort(source=process.env){
  const raw=source.LOOPS_OLLAMA_PORT??'11439';
  assert(/^\d{4,5}$/.test(raw),'LOOPS_OLLAMA_PORT must be a nonprivileged decimal port.');
  const port=Number(raw);
  assert(port>=1024&&port<=65535&&![11434,18789,19491,19691].includes(port),'LOOPS_OLLAMA_PORT conflicts with a reserved personal or Gateway port.');
  return port;
}
function containedDir(path){
  privateDir(path);
  assert.equal(canonical(path),path,'Isolated directory must not redirect through a symlink.');
  return path;
}
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
const gatewayMethods=new Set(['sessions.create','sessions.patch','chat.history','chat.send','plugins.sessionAction']);
export function admitOpenClawArgs(root,args){
  const exact=(...want)=>args.length===want.length&&args.every((value,index)=>value===want[index]);
  if(exact('plugins','build'))return 'build';
  if(exact('gateway','run'))return 'gateway';
  if(exact('config','validate'))return 'runtime';
  if(exact('models','auth','login','--provider','openai'))return 'codex-auth';
  if(args[0]==='plugins'&&args[1]==='info'&&['codex','loops-poc'].includes(args[2])&&
     (args.length===3||(args.length===4&&args[3]==='--json')))return 'runtime';
  if(args[0]==='plugins'&&args[1]==='install'&&args.length>=3){
    const spec=args[2],flags=args.slice(3);
    assert(flags.every(flag=>['--force','--accept-capabilities'].includes(flag))&&new Set(flags).size===flags.length,'Unapproved plugin install option.');
    if(spec==='@openclaw/codex')return 'codex-install';
    assert(spec.startsWith('npm-pack:'),'Only a checked-out package archive or @openclaw/codex can be installed.');
    const archive=canonical(spec.slice('npm-pack:'.length)),project=canonical(root);
    assert(inside(archive,project)&&archive.endsWith('.tgz'),'Plugin archive must be inside this checkout.');
    return 'runtime';
  }
  if(args[0]==='gateway'&&args[1]==='call'&&gatewayMethods.has(args[2])){
    let params=false,json=false,timeout=false;
    for(let index=3;index<args.length;index++){
      const option=args[index];
      if(option==='--params'&&!params){
        const value=JSON.parse(args[++index]??'null');
        assert(value&&typeof value==='object'&&!Array.isArray(value),'Gateway parameters must be a JSON object.');params=true;
      }else if(option==='--json'&&!json)json=true;
      else if(option==='--timeout'&&!timeout){assert(/^\d{1,7}$/.test(args[++index]??''),'Invalid Gateway timeout.');timeout=true;}
      else throw Error('Unapproved Gateway call option.');
    }
    assert(params&&json,'Gateway calls require JSON parameters and output.');
    return 'gateway-call';
  }
  if(args[0]==='agent'){
    const values=new Map(),flags=new Set(['--agent','--session-key','--message','--timeout']);
    let json=false;
    for(let index=1;index<args.length;index++){
      const option=args[index];
      if(option==='--json'&&!json)json=true;
      else if(flags.has(option)&&!values.has(option)){values.set(option,args[++index]);}
      else throw Error('Unapproved agent command option.');
    }
    assert(json&&['--agent','--session-key','--message'].every(flag=>typeof values.get(flag)==='string'&&values.get(flag).length>0),'Agent command requires an explicit isolated session and JSON output.');
    if(values.has('--timeout'))assert(/^\d{1,4}$/.test(values.get('--timeout')),'Invalid agent timeout.');
    return 'agent';
  }
  throw Error('OpenClaw command is not admitted by the isolated development wrapper.');
}
export function admitOllamaArgs(args){
  if(args.length===1&&['serve','list','ps'].includes(args[0]))return args[0];
  if(args.length===2&&['pull','show'].includes(args[0])&&/^[a-zA-Z0-9._/-]+:[a-zA-Z0-9._-]+$/.test(args[1]))return args[0];
  throw Error('Ollama command is not admitted by the isolated development wrapper.');
}
function checkInherited(source,expected){
  for(const [key,path] of Object.entries(expected)){
    if(source[key]!==undefined&&resolve(source[key])!==path)throw Error(key+' points outside the isolated profile.');
  }
}
function validateModelSelection(selection,prefix){
  if(selection===undefined)return;
  const model=typeof selection==='string'?{primary:selection,fallbacks:[]}:selection;
  assert(typeof model?.primary==='string'&&model.primary.startsWith(prefix),'Default model must use this profile\'s approved provider.');
  assert(Array.isArray(model.fallbacks??[])&&(model.fallbacks??[]).every(value=>typeof value==='string'&&value.startsWith(prefix)),'Model fallbacks must use this profile\'s approved provider.');
}
export function validateProfileConfig(config,name,project,profile,selectedOllamaPort=11439){
  const provider=name==='ollama'?'ollama':'openai',prefix=provider+'/';
  assert.deepEqual(Object.keys(config.models?.providers??{}),[provider],'Profile must configure only its approved provider.');
  const selected=config.models.providers[provider];
  if(name==='ollama'){
    assert.deepEqual(Object.keys(selected).sort(),['api','apiKey','baseUrl','models'],'Ollama provider has unapproved settings.');
    assert.equal(selected.baseUrl,'http://127.0.0.1:'+selectedOllamaPort,'Ollama provider must use the selected disposable worker endpoint.');
    assert.equal(selected.api,'ollama');
    assert.equal(selected.apiKey,'ollama-local');
  }else{
    assert.deepEqual(Object.keys(selected),['agentRuntime'],'Codex provider must use the public agent runtime without a direct endpoint or key.');
    assert.deepEqual(selected.agentRuntime,{id:'codex'},'Codex runtime must not carry an external path or provider override.');
  }
  assert(config.agents?.defaults?.model,'Default model selection is required.');
  validateModelSelection(config.agents?.defaults?.model,prefix);
  for(const key of Object.keys(config.agents?.defaults?.models??{}))assert(key.startsWith(prefix),'Configured model routes must use this profile\'s approved provider.');
  for(const agent of config.agents?.list??[]){
    validateModelSelection(agent.model,prefix);
    if(agent.workspace)assert.equal(resolve(project,agent.workspace),join(profile,'workspace'),'Agent workspace escapes this profile.');
  }
  assert.equal(config.discovery?.mdns?.mode,'off','Development discovery must remain disabled.');
  assert(!config.gateway?.tailscale||config.gateway.tailscale.mode==='off','Gateway tailnet exposure is not admitted.');
  assert(!config.gateway?.remote,'Remote Gateway configuration is not admitted.');
  assert(![18789,11434,11439].includes(config.gateway?.port),'Gateway cannot reuse a personal or provider port.');
  for(const path of config.plugins?.load?.paths??[]){
    const actual=canonical(path);
    assert(inside(actual,project),'Plugin load path escapes this checkout.');
  }
  const admittedPlugins=new Set(name==='ollama'?['loops-poc','ollama']:['loops-poc','codex']);
  for(const id of config.plugins?.allow??[])assert(admittedPlugins.has(id),'An unrelated plugin allowlist entry is not admitted in this profile.');
  for(const [id,entry] of Object.entries(config.plugins?.entries??{})){
    if(entry?.enabled!==false)assert(admittedPlugins.has(id),'An unrelated enabled plugin is not admitted in this profile.');
  }
  assert(config.plugins?.entries?.codex?.config?.sessionCatalog?.enabled!==true,'Personal session-catalog discovery is not admitted.');
  for(const entry of Object.values(config.channels??{}))assert(entry?.enabled===false,'External channel delivery is not admitted in this profile.');
  const browser=config.browser??{};
  assert(!browser.cdpUrl&&!browser.wsEndpoint,'External browser endpoints are not admitted.');
  for(const entry of Object.values(browser.profiles??{})){
    assert(!entry.cdpUrl&&!entry.wsEndpoint,'External browser profile endpoints are not admitted.');
    if(entry.userDataDir)assert(inside(canonical(entry.userDataDir),join(profile,'browser')),'Browser profile path escapes this profile.');
  }
  const inspectEnv=value=>{
    if(!value||typeof value!=='object')return;
    for(const [key,entry] of Object.entries(value)){
      assert(!secret.test(key),'Profile contains an inherited-provider credential override.');
      inspectEnv(entry);
    }
  };
  inspectEnv(config.env);
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
  if(name==='ollama')assert.notEqual(port,ollamaPort(source),'Gateway and provider cannot share a port.');
  if(config.logging?.file)assert.equal(resolve(project,config.logging.file),join(profile,'gateway.log'),'Gateway log must remain in this profile.');
  validateProfileConfig(config,name,project,profile,name==='ollama'?ollamaPort(source):11439);
  for(const dir of [state,workspace,cache,browser,home])containedDir(dir);
  const xdgConfig=containedDir(join(profile,'xdg-config')),xdgData=containedDir(join(profile,'xdg-data')),temporary=containedDir(join(profile,'tmp'));
  const expected={OPENCLAW_CONFIG_PATH:configPath,OPENCLAW_STATE_DIR:state,OPENCLAW_HOME:home,XDG_CACHE_HOME:cache,PLAYWRIGHT_BROWSERS_PATH:browser,CHROME_USER_DATA_DIR:browser};
  checkInherited(source,expected);
  const env={...cleanEnvironment(source),...expected,HOME:home,XDG_CONFIG_HOME:xdgConfig,XDG_DATA_HOME:xdgData,TMPDIR:temporary,TMP:temporary,TEMP:temporary,OPENCLAW_LOG_LEVEL:'info'};
  return {profile,config,port,env};
}
export function buildEnvironment(root,source=process.env){
  const home=containedDir(join(developmentBase(canonical(root)),'build-home'));
  const cache=containedDir(join(home,'cache')),temporary=containedDir(join(home,'tmp'));
  return {...cleanEnvironment(source),HOME:home,OPENCLAW_HOME:home,XDG_CONFIG_HOME:home,XDG_DATA_HOME:home,XDG_CACHE_HOME:cache,TMPDIR:temporary,TMP:temporary,TEMP:temporary};
}
export function portOccupied(port,host='127.0.0.1'){
  return new Promise(done=>{
    const socket=createConnection({host,port});
    socket.once('connect',()=>{socket.destroy();done(true);});
    socket.once('error',error=>{socket.destroy();done(error.code!=='ECONNREFUSED');});
    socket.setTimeout(1000,()=>{socket.destroy();done(true);});
  });
}
export function acquireLease(file,kind,owner=null,receiptDir=null,port=null){
  containedDir(dirname(file));
  const receipt={kind,owner,port,parentPid:process.pid,childPid:null,phase:'starting',id:randomUUID(),startedAt:new Date().toISOString()};
  for(let attempt=0;attempt<2;attempt++){
    try{
      writeFileSync(file,JSON.stringify(receipt)+'\n',{flag:'wx',mode:0o600});
      const update=fields=>{
        const current=JSON.parse(readFileSync(file,'utf8'));
        assert.equal(current.id,receipt.id,'Owned lease changed during service startup.');
        Object.assign(receipt,fields);
        const staged=file+'.'+randomUUID()+'.tmp';
        writeFileSync(staged,JSON.stringify(receipt)+'\n',{flag:'wx',mode:0o600});
        renameSync(staged,file);
      };
      return {
        markChild(pid){assert(Number.isInteger(pid)&&pid>0,'Owned child did not start.');update({childPid:pid});},
        markReady(){assert(receipt.childPid&&live(receipt.childPid),'Owned child exited before readiness.');update({phase:'ready',readyAt:new Date().toISOString()});},
        release(outcome={}){
          let removed=false;
          try{if(JSON.parse(readFileSync(file,'utf8')).id===receipt.id){rmSync(file);removed=true;}}catch{/* retain foreign or already missing lease */}
          if(receiptDir){
            containedDir(receiptDir);
            const saved={...receipt,endedAt:new Date().toISOString(),exitCode:outcome.code??null,signal:outcome.signal??null,leaseRemoved:removed,childAlive:receipt.childPid?live(receipt.childPid):false};
            writeFileSync(join(receiptDir,'cleanup-'+receipt.id+'.json'),JSON.stringify(saved,null,2)+'\n',{flag:'wx',mode:0o600});
          }
          return removed;
        },
      };
    }catch(error){
      if(error.code!=='EEXIST')throw error;
      if(lstatSync(file).isSymbolicLink())throw Error(kind+' lease path is a symlink.',{cause:error});
      let current;
      try{current=JSON.parse(readFileSync(file,'utf8'));}catch(parseError){throw Error(kind+' lease is unreadable; inspect it before retrying.',{cause:parseError});}
      if(!Number.isInteger(current.parentPid)||live(current.parentPid)||current.childPid&&live(current.childPid))throw Error(kind+' is owned by another live process.',{cause:error});
      if(JSON.parse(readFileSync(file,'utf8')).id!==current.id)continue;
      rmSync(file);
    }
  }
  throw Error('Unable to acquire '+kind+' lease.');
}
export function activeLease(file,kind,owner,port=null){
  try{
    if(lstatSync(file).isSymbolicLink())return false;
    const receipt=JSON.parse(readFileSync(file,'utf8'));
    return receipt.kind===kind&&receipt.owner===owner&&receipt.port===port&&receipt.phase==='ready'&&
      Number.isInteger(receipt.parentPid)&&live(receipt.parentPid)&&Number.isInteger(receipt.childPid)&&live(receipt.childPid);
  }catch{return false;}
}
export async function runOwned(binary,args,env,lease=null,readyPort=null,guard=null){
  let child,readinessTimer,guardTimer,stopTimer,result;
  const signalOwned=signal=>{
    if(!child?.pid)return;
    try{process.kill(-child.pid,signal);}catch{if(child.exitCode===null)child.kill(signal);}
  };
  const forward=signal=>{
    if(child?.exitCode===null){
      signalOwned(signal);
      if(!stopTimer)stopTimer=setTimeout(()=>{if(child?.exitCode===null)signalOwned('SIGKILL');},5000);
    }
  };
  try{
    child=spawn(binary,args,{stdio:'inherit',env,detached:true});
    if(lease&&child.pid)lease.markChild(child.pid);
    if(lease&&readyPort!==null){
      let checking=false;
      readinessTimer=setInterval(async()=>{
        if(checking||!child||!live(child.pid))return;
        checking=true;
        try{if(await portOccupied(readyPort)){lease.markReady();clearInterval(readinessTimer);}}
        catch(error){console.error('Owned service readiness failed: '+error.message);forward('SIGTERM');}
        finally{checking=false;}
      },100);
    }
    if(guard)guardTimer=setInterval(async()=>{
      try{if(!await guard())forward('SIGTERM');}
      catch{forward('SIGTERM');}
    },500);
    process.on('SIGINT',forward);process.on('SIGTERM',forward);
    result=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>done({code,signal}));});
    process.exitCode=result.signal?128+(result.signal==='SIGINT'?2:15):result.code??1;
  }catch(error){
    if(child?.pid&&child.exitCode===null){
      signalOwned('SIGTERM');
      await new Promise(done=>{
        if(child.exitCode!==null||child.signalCode!==null){done();return;}
        const timeout=setTimeout(()=>{signalOwned('SIGKILL');done();},2000);
        child.once('exit',()=>{clearTimeout(timeout);done();});
      });
    }
    throw error;
  }finally{
    clearInterval(readinessTimer);clearInterval(guardTimer);clearTimeout(stopTimer);
    process.off('SIGINT',forward);process.off('SIGTERM',forward);
    if(child?.pid)signalOwned('SIGTERM');
    if(lease){
      const removed=lease.release(result??{});
      console.error(removed?'Owned child exited; lease released and cleanup receipt saved.':'Owned child exited; lease mismatch recorded in cleanup receipt.');
    }
  }
}
export async function runOpenClaw(root,args,source=process.env){
  assertNode();const cli=installedHost(root);
  const command=admitOpenClawArgs(root,args);
  if(command==='build')return runOwned(process.execPath,[cli,...args],buildEnvironment(root,source));
  const name=source.LOOPS_PROFILE??'ollama',profile=profileEnvironment(root,name,source);
  if(['codex-auth','codex-install'].includes(command))assert.equal(name,'codex-test','Codex authentication and installation require the isolated Codex profile.');
  const lease=join(profile.profile,'gateway.lease.json');
  const inferenceLease=join(canonical(tmpdir()),'openclaw-loops-inference-'+(process.getuid?.()??'local')+'.lease.json');
  const modelPort=name==='ollama'?ollamaPort(source):null;
  const providerReady=async()=>activeLease(inferenceLease,'inference-worker',canonical(root),modelPort)&&await portOccupied(modelPort);
  if(command==='gateway'){
    assert(!(await portOccupied(profile.port)),'Gateway port is occupied by an existing service.');
    if(name==='ollama')assert(await providerReady(),'Gateway requires its own ready disposable inference worker.');
    return runOwned(process.execPath,[cli,...args],profile.env,
      acquireLease(lease,'gateway',profile.profile,join(profile.profile,'receipts'),profile.port),profile.port,
      name==='ollama'?providerReady:null);
  }
  if(['gateway-call','agent'].includes(command)){
    assert(activeLease(lease,'gateway',profile.profile,profile.port)&&await portOccupied(profile.port),'Gateway command requires its own ready service.');
  }else if(await portOccupied(profile.port)){
    assert(activeLease(lease,'gateway',profile.profile,profile.port),'Gateway port is occupied by an unowned service.');
  }
  return runOwned(process.execPath,[cli,...args],profile.env);
}
export function ollamaEnvironment(root,source=process.env){
  const project=canonical(root),base=developmentBase(project),models=containedDir(join(base,'ollama-models'));
  const host='127.0.0.1:'+ollamaPort(source);
  if(source.OLLAMA_MODELS!==undefined&&resolve(source.OLLAMA_MODELS)!==models)throw Error('OLLAMA_MODELS points outside this checkout.');
  if(source.OLLAMA_HOST!==undefined&&source.OLLAMA_HOST!==host)throw Error('OLLAMA_HOST points outside the selected dedicated service.');
  const home=containedDir(join(base,'ollama-home')),cache=containedDir(join(base,'ollama-cache')),temporary=containedDir(join(base,'ollama-tmp'));
  return {...cleanEnvironment(source),OLLAMA_HOST:host,OLLAMA_MODELS:models,OLLAMA_CONTEXT_LENGTH:'32768',OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',OLLAMA_FLASH_ATTENTION:'1',OLLAMA_KV_CACHE_TYPE:'q8_0',OLLAMA_NO_CLOUD:'1',HOME:home,OPENCLAW_HOME:home,XDG_CONFIG_HOME:home,XDG_DATA_HOME:home,XDG_CACHE_HOME:cache,TMPDIR:temporary,TMP:temporary,TEMP:temporary};
}
export async function runOllama(root,args,source=process.env){
  assertNode();const command=admitOllamaArgs(args);
  const project=canonical(root),binary=source.LOOPS_OLLAMA_BIN;
  assert(binary&&isAbsolute(binary)&&existsSync(binary)&&statSync(binary).isFile(),'Set LOOPS_OLLAMA_BIN to an explicit Ollama executable.');
  const executable=canonical(binary);
  assert(!executable.includes(sep+'.openclaw'+sep),'Personal OpenClaw paths are forbidden.');
  const env=ollamaEnvironment(root,source);
  const lease=join(canonical(tmpdir()),'openclaw-loops-inference-'+(process.getuid?.()??'local')+'.lease.json');
  const serve=command==='serve';
  const port=ollamaPort(source);
  if(serve)assert(!(await portOccupied(port)),'Inference port is occupied by an existing provider daemon.');
  else assert(activeLease(lease,'inference-worker',project,port)&&await portOccupied(port),'Start the owned ready inference worker first.');
  return runOwned(executable,args,env,serve?acquireLease(lease,'inference-worker',project,join(developmentBase(project),'receipts'),port):null,serve?port:null);
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
