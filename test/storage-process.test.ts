import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {build} from 'esbuild';
import {fork,spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SqliteStorage} from '../src/storage.js';
import {examples} from '../src/examples.js';
import type {State} from '../src/engine.js';

let bundleDirectory:string;
const cleanups:Array<()=>void|Promise<void>>=[];
beforeAll(async()=>{
  bundleDirectory=mkdtempSync(join(tmpdir(),'loops-storage-code-'));
  await build({entryPoints:['src/storage.ts'],outfile:join(bundleDirectory,'storage.mjs'),bundle:true,platform:'node',format:'esm',target:'node24'});
  copyFileSync('src/storage-worker.mjs',join(bundleDirectory,'storage-worker.mjs'));
});
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
afterAll(()=>rmSync(bundleDirectory,{recursive:true,force:true}));
function fixture(){
  const directory=mkdtempSync(join(tmpdir(),'loops-storage-process-'));
  cleanups.push(()=>rmSync(directory,{recursive:true,force:true}));
  return {directory,file:join(directory,'loops.sqlite'),ready:join(directory,'ready'),release:join(directory,'release')};
}
type Fixture=ReturnType<typeof fixture>;
type OwnerResult={state:'owned'|'rejected';pid:number;error?:string;snapshot?:State};
function exited(child:ChildProcess){
  if(child.exitCode!==null||child.signalCode!==null)return Promise.resolve();
  return new Promise<void>(resolve=>child.once('exit',()=>resolve()));
}
function start(paths:Fixture,mode='normal',state?:State){
  const stateFile=state?join(paths.directory,'initial.json'):'';
  if(state)writeFileSync(stateFile,JSON.stringify(state));
  const child=fork(resolve('test/helpers/storage-owner.mjs'),[paths.file,join(bundleDirectory,'storage.mjs'),mode,paths.ready,paths.release,stateFile],{execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
  const exit=exited(child);
  cleanups.push(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exit;});
  let stderr='';child.stderr?.on('data',data=>{stderr=(stderr+String(data)).slice(-2000);});
  const result=new Promise<OwnerResult>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Storage child did not report: '+stderr)),12000);
    child.once('message',message=>{clearTimeout(timer);resolve(message as OwnerResult);});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('Storage child exited before reporting: '+stderr));});
  });
  // Some crash tests intentionally terminate the owner before it can report.
  void result.catch(()=>{});
  return {child,result,exit};
}
function stalePid(file:string){
  const result=spawnSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{encoding:'utf8'});
  expect(result.status).toBe(0);const pid=Number(result.stdout);
  expect(()=>process.kill(pid,0)).toThrow(expect.objectContaining({code:'ESRCH'}));
  mkdirSync(file+'.lock');writeFileSync(file+'.lock/pid',String(pid));
}
const state=():State=>({version:1,loops:{'summarize-text':{definition:{...structuredClone(examples[0]),revision:1},enabledRevision:null,grants:[]}},runs:{}});

describe('storage ownership across processes',()=>{
  it('admits exactly one stale-lock reclaimer even when removal is delayed',async()=>{
    const paths=fixture();stalePid(paths.file);
    const delayed=start(paths,'stale-removal');
    await vi.waitFor(()=>expect(existsSync(paths.ready)).toBe(true),{timeout:5000});
    const competing=await start(paths).result;
    writeFileSync(paths.release,'release');const owner=await delayed.result;
    expect(competing).toMatchObject({state:'rejected',error:expect.stringContaining('already open')});
    expect(owner.state).toBe('owned');
    expect(Number(readFileSync(paths.file+'.lock/pid','utf8'))).toBe(owner.pid);
  });
  it('preserves ownership after rejected same-process and other-process contenders',async()=>{
    const paths=fixture(),store=new SqliteStorage(paths.file);cleanups.push(()=>store.close());store.write(state());
    const leaseInode=statSync(paths.file+'.owner.sqlite').ino,pidMarker=readFileSync(paths.file+'.lock/pid','utf8');
    expect(()=>new SqliteStorage(paths.file)).toThrow(/already open/);
    expect(await start(paths).result).toMatchObject({state:'rejected',error:expect.stringContaining('already open')});
    expect(readFileSync(paths.file+'.lock/pid','utf8')).toBe(pidMarker);expect(store.read()).toEqual(state());
    await store.close();
    const successor=await start(paths).result;expect(successor).toMatchObject({state:'owned',snapshot:state()});
    expect(statSync(paths.file+'.owner.sqlite').ino).toBe(leaseInode);
    expect(statSync(paths.file+'.owner.sqlite').mode&0o777).toBe(0o600);
  });
  it('releases ownership on SIGKILL and retains committed records for its successor',async()=>{
    const paths=fixture(),owner=start(paths,'normal',state());expect((await owner.result).state).toBe('owned');
    owner.child.kill('SIGKILL');await owner.exit;
    expect(existsSync(paths.file+'.lock/pid')).toBe(true);
    const store=new SqliteStorage(paths.file);cleanups.push(()=>store.close());
    expect(store.read()).toEqual(state());expect(store.integrity()).toEqual([{integrity_check:'ok'}]);
  });
  it('recovers when a process dies before publishing its complete PID marker',async()=>{
    const paths=fixture(),owner=start(paths,'publish-owner');
    await vi.waitFor(()=>expect(existsSync(paths.ready)).toBe(true),{timeout:5000});
    expect(existsSync(paths.file+'.lock')).toBe(false);
    owner.child.kill('SIGKILL');await owner.exit;
    const successor=await start(paths,'normal',state()).result;expect(successor).toMatchObject({state:'owned',snapshot:state()});
  });
  it('uses the lease to recover a modern marker whose PID now names a live process',async()=>{
    const paths=fixture();mkdirSync(paths.file+'.lock');
    writeFileSync(paths.file+'.lock/pid',String(process.pid));writeFileSync(paths.file+'.lock/protocol','sqlite-owner-v1');
    expect(await start(paths).result).toMatchObject({state:'owned'});
  });
  it('preserves a live legacy owner marker and releases the attempted lease',async()=>{
    const paths=fixture();mkdirSync(paths.file+'.lock');writeFileSync(paths.file+'.lock/pid',String(process.pid));
    expect(await start(paths).result).toMatchObject({state:'rejected',error:expect.stringContaining(`process ${process.pid}`)});
    expect(readFileSync(paths.file+'.lock/pid','utf8')).toBe(String(process.pid));
    rmSync(paths.file+'.lock',{recursive:true});expect(await start(paths).result).toMatchObject({state:'owned'});
  });
});

describe('real SQLite transaction faults',()=>{
  it.each(['full','rollback-failure','before-commit','after-commit'])('%s preserves the transaction boundary and permits explicit recovery',async scenario=>{
    const paths=fixture(),initial=state(),updated=state();
    for(let i=0;i<100;i++){
      const d={...structuredClone(examples[0]),id:`transaction-${i}`,slug:`transaction-${i}`,revision:1};
      updated.loops[d.id]={definition:d,enabledRevision:null,grants:[]};
    }
    const initialFile=join(paths.directory,'initial.json'),updatedFile=join(paths.directory,'updated.json'),control=join(paths.directory,'control');
    writeFileSync(initialFile,JSON.stringify(initial));writeFileSync(updatedFile,JSON.stringify(updated));
    const child=spawn(process.execPath,['--import',pathToFileURL(resolve('test/helpers/sqlite-fault.mjs')).href,resolve('test/helpers/storage-transaction.mjs'),paths.file,join(bundleDirectory,'storage.mjs'),scenario,initialFile,updatedFile],{
      stdio:['ignore','pipe','pipe'],env:{...process.env,LOOPS_TEST_SQLITE_CONTROL:control,LOOPS_TEST_SQLITE_READY:paths.ready},
    });
    const exit=exited(child);let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=String(data);});child.stderr.on('data',data=>{stderr=(stderr+String(data)).slice(-3000);});
    cleanups.push(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exit;});
    if(scenario==='full'||scenario==='rollback-failure'){
      await exit;expect(child.exitCode,stderr).toBe(0);
      const result=JSON.parse(stdout);
      if(scenario==='full'){
        expect(result.error).toMatch(/database or disk is full/);expect(result.afterFailure).toEqual(initial);expect(result.afterRecovery).toEqual(updated);
      }else{
        expect(result.error).toMatch(/rollback could not be verified/);expect(result.readError).toMatch(/rollback could not be verified/);expect(result.afterRecovery).toEqual(initial);
      }
      expect(result.integrity).toEqual([{integrity_check:'ok'}]);
    }else{
      await vi.waitFor(()=>{expect(child.exitCode,stderr).toBeNull();expect(existsSync(paths.ready),stderr).toBe(true);},{timeout:5000});
      child.kill('SIGKILL');await exit;
      const recovered=new SqliteStorage(paths.file);cleanups.push(()=>recovered.close());
      expect(recovered.read()).toEqual(scenario==='before-commit'?initial:updated);expect(recovered.integrity()).toEqual([{integrity_check:'ok'}]);
    }
  },10000);
});
