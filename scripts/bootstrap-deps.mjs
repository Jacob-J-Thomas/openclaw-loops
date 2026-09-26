import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {closeSync,existsSync,lstatSync,mkdirSync,openSync,readFileSync,realpathSync,renameSync,rmdirSync,statSync,writeFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';

const allowedVersions=new Set(['24.16.0','26.1.0']);
const source=process.env;
const project=source.LOOPS_BOOTSTRAP_PROJECT;
const phase=source.LOOPS_BOOTSTRAP_PHASE;
const version=source.LOOPS_BOOTSTRAP_VERSION;
const nodeArgument=source.LOOPS_BOOTSTRAP_NODE_BIN;
const npmArgument=source.LOOPS_BOOTSTRAP_NPM_CLI;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const die=message=>{throw Error(`Dependency bootstrap: ${message}`);};

assert(phase==='toolchain'||phase==='ci','Choose toolchain or ci.');
assert(allowedVersions.has(version),'Choose exact Node 24.16.0 or 26.1.0.');
assert(isAbsolute(project)&&isAbsolute(nodeArgument)&&isAbsolute(npmArgument),'All bootstrap paths must be absolute.');
assert.equal(realpathSync(process.cwd()),project,'Run bootstrap from its own checkout root.');
assert.equal(realpathSync(resolve(import.meta.dirname,'..')),project,'Bootstrap helper belongs to another checkout.');
assert.equal(realpathSync(project),project,'Checkout path must be canonical.');

function inside(path){
  const part=relative(project,path);
  assert(part&&!part.startsWith(`..${sep}`)&&part!=='..'&&!isAbsolute(part),`Path escapes this checkout: ${path}`);
  return part.split(sep);
}
function containedDirectory(path,{privateMode=true}={}){
  let current=project;
  for(const component of inside(path)){
    current=join(current,component);
    if(existsSync(current)){
      const info=lstatSync(current);
      assert(info.isDirectory()&&!info.isSymbolicLink(),`Unsafe bootstrap directory: ${current}`);
    }else{
      // lstat also catches a dangling symlink, which existsSync would miss.
      try{lstatSync(current);die(`Unsafe bootstrap directory: ${current}`);}catch(error){if(error.code!=='ENOENT')throw error;}
      mkdirSync(current,{mode:0o700});
    }
    assert.equal(realpathSync(current),current,`Bootstrap directory escaped: ${current}`);
    if(privateMode&&current!==join(project,'.dev-profile'))assert.equal(statSync(current).mode&0o077,0,`Bootstrap directory is not private: ${current}`);
  }
  return path;
}
function existingContainedDirectory(path){
  let current=project;
  for(const component of inside(path)){
    current=join(current,component);
    const info=lstatSync(current);
    assert(info.isDirectory()&&!info.isSymbolicLink(),`Unsafe bootstrap directory: ${current}`);
    assert.equal(realpathSync(current),current,`Bootstrap directory escaped: ${current}`);
  }
  return path;
}
function existingContainedExecutable(path,label){
  existingContainedDirectory(dirname(path));
  const info=lstatSync(path);
  assert(info.isFile()&&!info.isSymbolicLink()&&(info.mode&0o111)!==0,`${label} must be an unlinked executable in this checkout.`);
  assert.equal(realpathSync(path),path,`${label} escaped this checkout.`);
  return path;
}
function pathEntryExists(path){
  try{lstatSync(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}
}
function containedFile(path){
  containedDirectory(dirname(path));
  if(pathEntryExists(path)){
    const info=lstatSync(path);
    assert(info.isFile()&&!info.isSymbolicLink(),`Unsafe bootstrap file: ${path}`);
    assert.equal(realpathSync(path),path,`Bootstrap file escaped: ${path}`);
    assert.equal(info.mode&0o077,0,`Bootstrap file is not private: ${path}`);
    assert.equal(info.size,0,`Bootstrap npm configuration must remain empty: ${path}`);
  }else closeSync(openSync(path,'wx',0o600));
}
function exactFile(path,label){
  const info=lstatSync(path);
  assert(info.isFile()&&!info.isSymbolicLink(),`${label} must be a regular checkout file.`);
  assert.equal(realpathSync(path),path,`${label} escaped the checkout.`);
  return path;
}
function executable(path,label){
  const actual=realpathSync(path),info=statSync(actual);
  assert(info.isFile()&&(info.mode&0o111)!==0,`${label} is not an executable file.`);
  return actual;
}
function runVersion(binary,args,env,label){
  const result=spawnSync(binary,args,{cwd:project,env,encoding:'utf8',timeout:15000,maxBuffer:65536});
  assert(!result.error&&result.status===0,`${label} version probe failed: ${result.error?.message??result.stderr?.trim()??'unknown error'}`);
  return result.stdout.trim();
}

exactFile(join(project,'package.json'),'Project manifest');
exactFile(join(project,'package-lock.json'),'Project lockfile');
if(pathEntryExists(join(project,'.npmrc')))exactFile(join(project,'.npmrc'),'Project npm configuration');
const lockBefore=sha(readFileSync(join(project,'package-lock.json')));
const privateRoot=containedDirectory(join(project,'.dev-profile','bootstrap'));
for(const name of ['home','config','data','cache','tmp','state','browser','npm-cache','npm-global','stages','receipts'])containedDirectory(join(privateRoot,name));
for(const name of ['npm-user.npmrc','npm-global.npmrc'])containedFile(join(privateRoot,'config',name));
const openclawConfig=join(privateRoot,'config','openclaw.json');
if(pathEntryExists(openclawConfig))exactFile(openclawConfig,'Bootstrap OpenClaw config');

const expected={HOME:join(privateRoot,'home'),OPENCLAW_HOME:join(privateRoot,'home'),OPENCLAW_CONFIG_PATH:join(privateRoot,'config','openclaw.json'),OPENCLAW_STATE_DIR:join(privateRoot,'state'),XDG_CONFIG_HOME:join(privateRoot,'config'),XDG_DATA_HOME:join(privateRoot,'data'),XDG_CACHE_HOME:join(privateRoot,'cache'),TMPDIR:join(privateRoot,'tmp'),TMP:join(privateRoot,'tmp'),TEMP:join(privateRoot,'tmp'),PLAYWRIGHT_BROWSERS_PATH:join(privateRoot,'browser'),CHROME_USER_DATA_DIR:join(privateRoot,'browser'),npm_config_userconfig:join(privateRoot,'config','npm-user.npmrc'),npm_config_globalconfig:join(privateRoot,'config','npm-global.npmrc'),npm_config_cache:join(privateRoot,'npm-cache'),npm_config_prefix:join(privateRoot,'npm-global')};
for(const [key,value] of Object.entries(expected))assert.equal(source[key],value,`Unsanitized or redirected bootstrap ${key}.`);
for(const key of Object.keys(source)){
  if(/^npm_config_/i.test(key))assert(Object.hasOwn(expected,key)&&source[key]===expected[key],`Inherited npm configuration: ${key}`);
  else assert(!/^(NODE_OPTIONS|NODE_PATH|NPM_TOKEN|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|OPENAI_|ANTHROPIC_|GOOGLE_|GEMINI_|OLLAMA_|AWS_|AZURE_|CODEX_)/i.test(key),`Inherited sensitive bootstrap variable: ${key}`);
}
const bootstrapNode=executable(nodeArgument,'Bootstrap Node');
assert.equal(realpathSync(process.execPath),bootstrapNode,'Bootstrap Node identity mismatch.');
const npmCli=realpathSync(npmArgument);
assert.equal(basename(npmCli),'npm-cli.js','Supply the actual npm CLI, not a shell or npx shim.');
assert(statSync(npmCli).isFile(),'npm CLI is not a file.');
const target=join(project,'.dev-profile','toolchains',`node-${version}`);
const pinned=join(target,'node_modules','node','bin','node');
const env={...source};
delete env.LOOPS_BOOTSTRAP_PROJECT;delete env.LOOPS_BOOTSTRAP_PHASE;delete env.LOOPS_BOOTSTRAP_VERSION;
delete env.LOOPS_BOOTSTRAP_NODE_BIN;delete env.LOOPS_BOOTSTRAP_NPM_CLI;
env.PATH=`${dirname(bootstrapNode)}:/usr/bin:/bin:/usr/sbin:/sbin`;
const bootstrapVersion=runVersion(bootstrapNode,['--version'],env,'Bootstrap Node');
assert(/^v(?:22|24|26)\.[0-9]+\.[0-9]+$/.test(bootstrapVersion),'Bootstrap Node must be a supported Node 22, 24, or 26 runtime.');
const npmVersion=runVersion(bootstrapNode,[npmCli,'--version'],env,'npm CLI');
assert(/^\d+\.\d+\.\d+$/.test(npmVersion),'npm CLI returned an invalid version.');
const quote=value=>`'${value.replaceAll("'", "'\"'\"'")}'`;
function npmEnvironment(nodeBinary){
  const bin=containedDirectory(join(privateRoot,'stages',`commands-${randomUUID()}`));
  writeFileSync(join(bin,'npm'),`#!/bin/sh\nexec ${quote(nodeBinary)} ${quote(npmCli)} "$@"\n`,{flag:'wx',mode:0o700});
  env.PATH=`${bin}:${dirname(nodeBinary)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  return bin;
}

let stage=null,command=null,exitCode=0,completed=false;
const receipt={phase,requestedNodeVersion:version,bootstrapNode,bootstrapNodeVersion:bootstrapVersion,npmCli,npmVersion,project,privateRoot,lockfileSha256Before:lockBefore,target,pinnedNode:pinned,startedAt:new Date().toISOString()};
try{
  if(phase==='toolchain'){
    containedDirectory(dirname(target),{privateMode:false});
    if(pathEntryExists(target)){
      existingContainedDirectory(target);
      assert.equal(runVersion(existingContainedExecutable(pinned,'Pinned Node'),['--version'],env,'Pinned Node'),`v${version}`,'Existing toolchain has the wrong version.');
      receipt.reusedExistingToolchain=true;
    }else{
      const gate=join(privateRoot,'stages',`node-${version}.gate`);
      mkdirSync(gate,{mode:0o700}); // An existing or stale gate requires inspection.
      try{
        assert(!pathEntryExists(target),'Another bootstrap created the target.');
        stage=join(privateRoot,'stages',`node-${version}-${randomUUID()}`);
        containedDirectory(stage);
        receipt.npmCommandBin=npmEnvironment(bootstrapNode);
        command=[bootstrapNode,npmCli,'install','--prefix',stage,`node@${version}`,'--no-audit','--no-fund'];
        const result=spawnSync(command[0],command.slice(1),{cwd:project,env,stdio:'inherit'});
        if(result.error)throw result.error;
        assert.equal(result.status,0,`Pinned Node install exited ${result.status??result.signal}.`);
        const staged=join(stage,'node_modules','node','bin','node');
        assert.equal(runVersion(existingContainedExecutable(staged,'Staged Node'),['--version'],env,'Staged Node'),`v${version}`,'Installed Node has the wrong version.');
        assert(!pathEntryExists(target),'Another bootstrap created the target.');
        renameSync(stage,target);stage=null;
        receipt.installedToolchain=true;
      }finally{rmdirSync(gate);}
    }
  }else{
    existingContainedDirectory(dirname(target));existingContainedDirectory(target);
    const pinnedNode=existingContainedExecutable(pinned,'Pinned Node');
    assert.equal(runVersion(pinnedNode,['--version'],env,'Pinned Node'),`v${version}`,'Pinned Node version mismatch.');
    const modules=join(project,'node_modules');
    if(pathEntryExists(modules))existingContainedDirectory(modules); // npm ci removes this tree.
    receipt.npmCommandBin=npmEnvironment(pinnedNode);
    command=[pinnedNode,npmCli,'ci','--no-audit','--no-fund'];
    const result=spawnSync(command[0],command.slice(1),{cwd:project,env,stdio:'inherit'});
    if(result.error)throw result.error;
    assert.equal(result.status,0,`npm ci exited ${result.status??result.signal}.`);
  }
  assert.equal(sha(readFileSync(join(project,'package-lock.json'))),lockBefore,'Project lockfile changed during bootstrap.');
  completed=true;
}catch(error){exitCode=1;receipt.error=error.message;}
receipt.command=command;receipt.stage=stage;receipt.completed=completed;receipt.finishedAt=new Date().toISOString();receipt.lockfileSha256After=sha(readFileSync(join(project,'package-lock.json')));
const receiptPath=join(privateRoot,'receipts',`${phase}-${version}-${randomUUID()}.json`);
writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({receipt:receiptPath,phase,requestedNodeVersion:version,bootstrapNode,bootstrapNodeVersion:bootstrapVersion,npmCli,npmVersion,pinnedNode:pinned,completed}));
if(receipt.error)console.error(receipt.error);
process.exitCode=exitCode;
