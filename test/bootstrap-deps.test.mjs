import {afterEach,describe,expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const fixtures=[];
afterEach(()=>{for(const path of fixtures.splice(0))rmSync(path,{recursive:true,force:true});});
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
  const root=realpathSync(mkdtempSync(join(tmpdir(),'loops-bootstrap-probe-')));fixtures.push(root);
  mkdirSync(join(root,'scripts'));
  for(const name of ['bootstrap-deps.sh','bootstrap-deps.mjs'])copyFileSync(resolve('scripts',name),join(root,'scripts',name));
  writeFileSync(join(root,'package.json'),'{"type":"module","name":"bootstrap-probe","version":"1.0.0"}\n');
  writeFileSync(join(root,'package-lock.json'),'{"name":"bootstrap-probe","lockfileVersion":3,"packages":{}}\n');
  const npm=join(root,'npm-cli.js');
  writeFileSync(npm,`
import {chmodSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
if(process.argv[2]==='--version'){console.log('10.9.7');process.exit(0);}
const mode=process.argv[2],out=join(process.env.HOME,'observed-'+mode+'.json');
const nested=spawnSync('npm',['--version'],{encoding:'utf8'});
writeFileSync(out,JSON.stringify({argv:process.argv.slice(2),env:process.env,nested:{status:nested.status,version:nested.stdout.trim()}},null,2));
if(mode==='install'){
  const prefix=process.argv[process.argv.indexOf('--prefix')+1];
  const bin=join(prefix,'node_modules','node','bin');mkdirSync(bin,{recursive:true});
  const shim='#!/bin/sh\\nif [ "$1" = "--version" ]; then echo v24.16.0; else exec "'+process.execPath+'" "$@"; fi\\n';
  writeFileSync(join(bin,'node'),shim);chmodSync(join(bin,'node'),0o700);
}
`);
  return {root,npm};
}
function launch({root,npm},phase,version='24.16.0',extraEnv={}){
  return spawnSync('/bin/sh',['scripts/bootstrap-deps.sh',phase,version,realpathSync(process.execPath),npm],{
    cwd:root,encoding:'utf8',timeout:15000,env:{...process.env,...extraEnv},maxBuffer:262144,
  });
}
const observed=(root,mode)=>JSON.parse(readFileSync(join(root,'.dev-profile','bootstrap','home',`observed-${mode}.json`),'utf8'));

describe('dependency bootstrap before lifecycle execution',()=>{
  it('runs both npm phases with private default paths and no inherited preload, credential, proxy, or npm configuration',()=>{
    const probe=fixture(),sentinel=join(probe.root,'preload-ran');
    const preload=join(probe.root,'preload.cjs');writeFileSync(preload,`require('node:fs').writeFileSync(${JSON.stringify(sentinel)},'executed')`);
    const inherited={NODE_OPTIONS:`--require ${preload}`,NODE_PATH:probe.root,OPENAI_API_KEY:'sentinel-key',ANTHROPIC_API_KEY:'sentinel-key',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',npm_config_userconfig:join(probe.root,'personal.npmrc'),NPM_CONFIG_REGISTRY:'https://invalid.example',OPENCLAW_CONFIG_PATH:join(probe.root,'personal.json')};
    const originalLock=hash(readFileSync(join(probe.root,'package-lock.json')));
    for(const mode of ['toolchain','ci']){
      if(mode==='ci'){
        const adjacentNpm=join(probe.root,'.dev-profile','toolchains','node-24.16.0','node_modules','node','bin','npm');
        writeFileSync(adjacentNpm,'#!/bin/sh\necho wrong-adjacent-npm\n',{mode:0o700});
      }
      const result=launch(probe,mode,'24.16.0',inherited);
      expect(result.status,`${mode}: ${result.stderr}`).toBe(0);
      const value=observed(probe.root,mode==='toolchain'?'install':'ci');
      expect(value.argv[0]).toBe(mode==='toolchain'?'install':'ci');
      expect(value.nested).toEqual({status:0,version:'10.9.7'});
      expect(value.env.HOME).toBe(join(probe.root,'.dev-profile','bootstrap','home'));
      expect(value.env.OPENCLAW_HOME).toBe(value.env.HOME);
      for(const key of ['XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','TMPDIR','TMP','TEMP','npm_config_userconfig','npm_config_globalconfig','npm_config_cache','npm_config_prefix','OPENCLAW_CONFIG_PATH','OPENCLAW_STATE_DIR'])expect(value.env[key].startsWith(join(probe.root,'.dev-profile','bootstrap')+'/'),key).toBe(true);
      for(const key of ['NODE_OPTIONS','NODE_PATH','OPENAI_API_KEY','ANTHROPIC_API_KEY','HTTP_PROXY','HTTPS_PROXY','NPM_CONFIG_REGISTRY','LOOPS_BOOTSTRAP_PROJECT'])expect(value.env[key]).toBeUndefined();
      expect(readFileSync(value.env.npm_config_userconfig,'utf8')).toBe('');
      expect(readFileSync(value.env.npm_config_globalconfig,'utf8')).toBe('');
    }
    expect(existsSync(sentinel)).toBe(false);
    expect(hash(readFileSync(join(probe.root,'package-lock.json')))).toBe(originalLock);
    expect(readFileSync(join(probe.root,'.dev-profile','toolchains','node-24.16.0','node_modules','node','bin','node'),'utf8')).toContain('v24.16.0');
  });

  it('rejects a linked private home and a linked pinned executable before npm dispatch',()=>{
    const probe=fixture(),external=realpathSync(mkdtempSync(join(tmpdir(),'loops-bootstrap-external-')));fixtures.push(external);
    const base=join(probe.root,'.dev-profile','bootstrap');mkdirSync(base,{recursive:true,mode:0o700});symlinkSync(external,join(base,'home'));
    const rejected=launch(probe,'toolchain');expect(rejected.status).not.toBe(0);expect(rejected.stderr).toContain('Symlink in bootstrap path');
    expect(existsSync(join(external,'observed-install.json'))).toBe(false);
    rmSync(join(base,'home'));
    expect(launch(probe,'toolchain').status).toBe(0);
    symlinkSync(external,join(probe.root,'node_modules'));
    const redirected=launch(probe,'ci');expect(redirected.status).not.toBe(0);expect(redirected.stderr).toContain('Unsafe bootstrap directory');
    expect(existsSync(join(base,'home','observed-ci.json'))).toBe(false);
    rmSync(join(probe.root,'node_modules'));
    const pinned=join(probe.root,'.dev-profile','toolchains','node-24.16.0','node_modules','node','bin','node');
    rmSync(pinned);symlinkSync(realpathSync(process.execPath),pinned);
    const ci=launch(probe,'ci');expect(ci.status).not.toBe(0);expect(ci.stderr).toContain('Pinned Node must be an unlinked executable');
    expect(existsSync(join(base,'home','observed-ci.json'))).toBe(false);
  });

  it('rejects unsupported actions, versions, and relative executable paths before any npm dispatch',()=>{
    const probe=fixture();
    for(const args of [
      ['install','24.16.0',realpathSync(process.execPath),probe.npm],
      ['toolchain','24.16.1',realpathSync(process.execPath),probe.npm],
      ['toolchain','24.16.0','node',probe.npm],
      ['toolchain','24.16.0',realpathSync(process.execPath),'npm'],
    ]){
      const result=spawnSync('/bin/sh',['scripts/bootstrap-deps.sh',...args],{cwd:probe.root,encoding:'utf8',timeout:15000,env:process.env});
      expect(result.status,args.join(' ')).not.toBe(0);
    }
    expect(existsSync(join(probe.root,'.dev-profile'))).toBe(false);
  });

  it('preserves an existing mismatched toolchain instead of reinstalling over it',()=>{
    const probe=fixture();expect(launch(probe,'toolchain').status).toBe(0);
    const pinned=join(probe.root,'.dev-profile','toolchains','node-24.16.0','node_modules','node','bin','node');
    const mismatch='#!/bin/sh\necho v24.16.1\n';writeFileSync(pinned,mismatch);
    const retry=launch(probe,'toolchain');expect(retry.status).not.toBe(0);
    expect(retry.stderr).toContain('Existing toolchain has the wrong version');
    expect(readFileSync(pinned,'utf8')).toBe(mismatch);
  });
});
