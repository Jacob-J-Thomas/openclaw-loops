import {afterEach,describe,expect,it} from 'vitest';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync,fork,spawn,spawnSync} from 'node:child_process';
import {appendLifecycleClientMilestone,createLifecycleOperations,lifecycleChildProcessState,lifecycleFailureReceipt,sanitizeLifecycleClientStartup} from '../scripts/lifecycle-failure-receipt.mjs';

const directories=[];
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});

describe('sanitized lifecycle failure receipt',()=>{
  it('identifies a host-state migration failure without exposing Doctor output',()=>{
    const privateOutput='private profile and credentials';
    const recorder=createLifecycleOperations(()=>({phase:'upgrade',restartOrdinal:0}));
    recorder.begin('host-state-migration');
    const receipt=lifecycleFailureReceipt('upgrade',new Error(privateOutput),undefined,undefined,recorder.snapshot());
    expect(receipt).toMatchObject({status:'failed',phase:'upgrade',activeOperation:{operation:'host-state-migration',outcome:'failed'}});
    expect(JSON.stringify(receipt)).not.toContain(privateOutput);
  });

  it.each(['sdk-client-startup','public-session-actions'])('captures a rejected %s callback before successful cleanup',async name=>{
    let now=0;
    const recorder=createLifecycleOperations(()=>({phase:'upgrade',restartOrdinal:1}),()=>now);
    await recorder.run('gateway-readiness',async()=>{now=3;});
    const error=Object.assign(new Error('timeout with private credentials'),{code:'ETIMEDOUT'});
    let reject;
    const pending=recorder.run(name,()=>new Promise((_,fail)=>{reject=fail;}));
    expect(recorder.completed().map(item=>item.operation)).toEqual(['gateway-readiness']);
    const rejected=expect(pending).rejects.toBe(error);
    now=13;reject(error);await rejected;
    const primary=recorder.snapshot();
    await recorder.run('gateway-shutdown',async()=>{now=19;});
    const receipt=lifecycleFailureReceipt('upgrade',error,undefined,undefined,primary);
    expect(receipt).toMatchObject({category:'timeout',activeOperation:{operation:name,outcome:'failed',elapsedMs:10,phase:'upgrade',restartOrdinal:1}});
    expect(receipt.completedOperations.map(item=>item.operation)).toEqual(['gateway-readiness']);
    expect(recorder.completed().map(item=>item.operation)).toEqual(['gateway-readiness','gateway-shutdown']);
    expect(JSON.stringify(receipt)).not.toContain('credentials');
  });

  it('retains the first cleanup failure when later cleanup succeeds',async()=>{
    let now=0;
    const recorder=createLifecycleOperations(()=>({phase:'upgrade',restartOrdinal:1}),()=>now);
    const primary=Object.assign(new Error('private RPC failure'),{code:'ECONNRESET'});
    await expect(recorder.run('public-session-actions',async()=>{now=4;throw primary;})).rejects.toBe(primary);
    const diagnostic=recorder.snapshot();
    const cleanup=Object.assign(new Error('private client timeout'),{code:'ETIMEDOUT'});
    await expect(recorder.run('client-shutdown',async()=>{now=9;throw cleanup;})).rejects.toBe(cleanup);
    const cleanupDiagnostic=recorder.record();
    await recorder.run('gateway-shutdown',async()=>{now=12;});
    const receipt=lifecycleFailureReceipt('upgrade',primary,undefined,undefined,{...diagnostic,cleanupError:cleanup,cleanup:cleanupDiagnostic});
    expect(receipt).toMatchObject({category:'connection',activeOperation:{operation:'public-session-actions',elapsedMs:4},cleanupFailure:{operation:'client-shutdown',elapsedMs:5,category:'timeout'}});
    const cleanupOnly=lifecycleFailureReceipt('upgrade',cleanup,undefined,undefined,{...cleanupDiagnostic,completedOperations:recorder.completed()});
    expect(cleanupOnly.activeOperation.operation).toBe('client-shutdown');
    expect(cleanupOnly.completedOperations.map(item=>item.operation)).toEqual(['gateway-shutdown']);
  });

  it('keeps recent bounded history, ignores duplicate completion and preserves the starting restart identity',async()=>{
    let restartOrdinal=-1,now=0;
    const recorder=createLifecycleOperations(()=>({phase:'upgrade',restartOrdinal}),()=>now);
    await recorder.run('gateway-readiness',async()=>{restartOrdinal++;now=2;},{restartOrdinal:restartOrdinal+1});
    expect(recorder.completed()[0]).toMatchObject({restartOrdinal:0,elapsedMs:2});
    for(let index=0;index<70;index++)await recorder.run('public-session-actions',async()=>{now++;});
    await recorder.run('sdk-client-startup',async()=>{now++;});
    recorder.complete();
    expect(recorder.completed()).toHaveLength(64);
    expect(recorder.completed().at(-1).operation).toBe('sdk-client-startup');
    recorder.begin('client-shutdown');recorder.abandon();recorder.complete();
    expect(recorder.completed()).toHaveLength(64);
    const receipt=lifecycleFailureReceipt('upgrade',new Error('failed'),undefined,undefined,recorder.snapshot());
    expect(receipt.activeOperation.operation).toBe('unknown');
    expect(receipt.completedOperations.at(-1).operation).toBe('sdk-client-startup');
    const long=lifecycleFailureReceipt('upgrade',new Error('failed'),undefined,undefined,{...recorder.snapshot(),completedOperations:[...Array(70).fill({operation:'installer',outcome:'completed',elapsedMs:1}),{operation:'client-shutdown',outcome:'completed',elapsedMs:3}]});
    expect(long.completedOperations).toHaveLength(64);
    expect(long.completedOperations.at(-1).operation).toBe('client-shutdown');
  });

  it.each([
    [{code:'ENOSPC'},'storage-full','Lifecycle storage capacity was exhausted.'],
    [{code:'EPERM'},'permission-denied','Lifecycle access was denied by the operating system.'],
    [{code:'ENOENT'},'required-file-missing','A required lifecycle file was unavailable.'],
    [{code:'ETIMEDOUT'},'timeout','A lifecycle operation timed out.'],
    [{code:'ECONNREFUSED'},'connection','A lifecycle connection failed.'],
    [{code:'ERR_ASSERTION'},'invariant','A lifecycle verification invariant failed.'],
    [{status:9},'subprocess-exit','A lifecycle subprocess exited unsuccessfully.'],
    [{message:'private unexpected detail'},'unexpected','Lifecycle verification failed unexpectedly.'],
  ])('maps a failure to the bounded %s diagnostic', (error,category,message)=>{
    expect(lifecycleFailureReceipt('upgrade',error)).toEqual({status:'failed',phase:'upgrade',category,message});
  });

  it('writes an uploaded-path receipt when a child fails without retaining its secret-bearing error',()=>{
    const directory=mkdtempSync(join(tmpdir(),'loops-lifecycle-failure-'));directories.push(directory);
    const secret='token=private-child-secret profile=/private/operator/config';
    const moduleUrl=pathToFileURL(new URL('../scripts/lifecycle-failure-receipt.mjs',import.meta.url).pathname).href;
    const artifacts={previous:{source:'7b2705bc2068f09e68e738ae199889feb69c1680',sha256:'a'.repeat(64),hostVersion:'2026.9.3',token:secret},current:{sha256:'b'.repeat(64),hostVersion:'2026.9.4',profile:secret},config:secret};
    const source=`import {writeLifecycleFailureReceipt} from ${JSON.stringify(moduleUrl)};\ntry { const error=Object.assign(new Error(${JSON.stringify(secret)}),{status:17,stderr:${JSON.stringify(secret)}}); throw error; } catch(error) { writeLifecycleFailureReceipt(process.env.RECEIPT_DIR,'uninstall-reinstall',error,${JSON.stringify(artifacts)}); process.exitCode=17; }`;
    const child=spawnSync(process.execPath,['--input-type=module','--eval',source],{encoding:'utf8',env:{...process.env,RECEIPT_DIR:directory}});
    expect(child.status).toBe(17);
    const text=readFileSync(join(directory,'receipt.json'),'utf8');
    expect(JSON.parse(text)).toEqual({status:'failed',phase:'uninstall-reinstall',category:'subprocess-exit',message:'A lifecycle subprocess exited unsuccessfully.',artifacts:{previous:{source:artifacts.previous.source,sha256:artifacts.previous.sha256,hostVersion:artifacts.previous.hostVersion},current:{sha256:artifacts.current.sha256,hostVersion:artifacts.current.hostVersion}}});
    expect(text).not.toContain(secret);
    expect(text).not.toMatch(/token|profile|config|stderr|stack|path/i);
  });

  it('replaces an unrecognized phase instead of serializing caller-controlled text',()=>{
    expect(lifecycleFailureReceipt('secret phase value',{message:'private'})).toEqual({status:'failed',phase:'unknown',category:'unexpected',message:'Lifecycle verification failed unexpectedly.'});
  });

  it('replaces invalid provenance and omits private metadata without throwing in the failure path',()=>{
    const secret='private-profile-token';
    expect(lifecycleFailureReceipt('archive-validation',new Error('failed'),{previous:{source:secret,sha256:'short',hostVersion:'bad/version',config:secret},current:{sha256:secret,hostVersion:'',token:secret}})).toEqual({status:'failed',phase:'archive-validation',category:'unexpected',message:'Lifecycle verification failed unexpectedly.',artifacts:{previous:{source:'unknown',sha256:'unknown',hostVersion:'unknown'},current:{sha256:'unknown',hostVersion:'unknown'}}});
  });

  it('adds only bounded readiness evidence when a lifecycle listener appears after the failed deadline',()=>{
    const secret='token=private-readiness-detail';
    const receipt=lifecycleFailureReceipt('upgrade',new Error('private'),undefined,{restartOrdinal:1,deadlineElapsedMs:15000,deadlineProcessState:'alive',postDeadlineAttempts:3,postDeadlineWindowMs:200,listenerAfterDeadline:true,listenerElapsedMs:15200,finalProcessState:'alive',secret});
    expect(receipt).toMatchObject({status:'failed',phase:'upgrade',category:'unexpected',readiness:{restartOrdinal:1,listenerAfterDeadline:true,listenerElapsedMs:15200}});
    expect(JSON.stringify(receipt)).not.toContain(secret);
  });

  it('retains only bounded public client-startup timing and process evidence',()=>{
    const secret='token=private-client-token ws://private.gateway/profile';
    const timings=Array.from({length:9},(_,index)=>({phase:index===0?'socket-open':'challenge',generation:index,durationMs:index,phaseDurationMs:index,hasChallenge:index>0,usedFallback:false,plan:secret}));
    const receipt=lifecycleFailureReceipt('upgrade',new Error('Gateway client startup timed out.'),undefined,undefined,{clientStartup:{restartOrdinal:1,budgetMs:15_000,listening:true,gatewayProcessState:'alive',clientProcessState:'alive',elapsedMs:15_000,timings,endpoint:secret}});
    expect(receipt).toMatchObject({category:'timeout',clientStartup:{restartOrdinal:1,budgetMs:15_000,listening:true,gatewayProcessState:'alive',clientProcessState:'alive',elapsedMs:15_000}});
    expect(receipt.clientStartup.timings.slice(0,2)).toMatchObject([{phase:'socket-open',generation:0},{phase:'challenge',generation:1,hasChallenge:true}]);
    expect(receipt.clientStartup.timings).toHaveLength(8);
    expect(JSON.stringify(receipt)).not.toContain(secret);
    const hostile={get timings(){throw Error(secret);},get gatewayProcessState(){throw Error(secret);}};
    expect(sanitizeLifecycleClientStartup(hostile)).toMatchObject({gatewayProcessState:'unavailable',clientProcessState:'unavailable',timings:[]});
  });

  it('accepts only ordered startup milestones and keeps worker execution separate from IPC receipt time',()=>{
    const secret='token=private-client /private/operator/path';
    let milestones=[];
    milestones=appendLifecycleClientMilestone(milestones,{type:'startup-milestone',phase:'worker-entry',sequence:0,workerElapsedMs:0,secret},17);
    expect(appendLifecycleClientMilestone(milestones,{type:'startup-milestone',phase:'client-started',sequence:2,workerElapsedMs:3},20)).toEqual(milestones);
    expect(appendLifecycleClientMilestone(milestones,{type:'startup-milestone',phase:secret,sequence:1,workerElapsedMs:3},20)).toEqual(milestones);
    milestones=appendLifecycleClientMilestone(milestones,{type:'startup-milestone',phase:'sdk-imported',sequence:1,workerElapsedMs:35,secret},58);
    expect(appendLifecycleClientMilestone(milestones,{type:'startup-milestone',phase:'client-started',sequence:2,workerElapsedMs:34},60)).toEqual(milestones);
    milestones=appendLifecycleClientMilestone(milestones,{type:'startup-milestone',phase:'client-started',sequence:2,workerElapsedMs:39,secret},64);
    expect(appendLifecycleClientMilestone(milestones,{type:'startup-milestone',phase:'client-started',sequence:2,workerElapsedMs:40},65)).toEqual(milestones);
    const receipt=lifecycleFailureReceipt('upgrade',new Error('Gateway client startup timed out.'),undefined,undefined,{clientStartup:{restartOrdinal:1,budgetMs:15000,elapsedMs:15000,milestones:[...milestones,{phase:secret,sequence:3,workerElapsedMs:42,receivedElapsedMs:70}],raw:secret}});
    expect(receipt.clientStartup.milestones).toEqual([{phase:'worker-entry',sequence:0,workerElapsedMs:0,receivedElapsedMs:17},{phase:'sdk-imported',sequence:1,workerElapsedMs:35,receivedElapsedMs:58},{phase:'client-started',sequence:2,workerElapsedMs:39,receivedElapsedMs:64}]);
    expect(receipt.category).toBe('timeout');
    expect(JSON.stringify(receipt)).not.toContain(secret);
    const hostile={get phase(){throw Error(secret);},sequence:0,workerElapsedMs:0,receivedElapsedMs:0};
    expect(sanitizeLifecycleClientStartup({milestones:[hostile]}).milestones).toEqual([]);
    expect(appendLifecycleClientMilestone([],{get type(){throw Error(secret);}},1)).toEqual([]);
  });

  it('forwards an allowlisted public client timing without a timeout override',async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-client-worker-'));directories.push(root);
    const packageRoot=join(root,'node_modules','openclaw');mkdirSync(packageRoot,{recursive:true});
    writeFileSync(join(root,'package.json'),JSON.stringify({name:'worker-fixture',private:true,type:'module'}));
    writeFileSync(join(packageRoot,'package.json'),JSON.stringify({name:'openclaw',private:true,type:'module',exports:{'./plugin-sdk/gateway-runtime':'./gateway-runtime.mjs'}}));
    writeFileSync(join(packageRoot,'gateway-runtime.mjs'),"export class GatewayClient { constructor(options){ this.options=options; } start(){ this.options.onTiming({phase:'challenge',generation:2,durationMs:7,phaseDurationMs:3,hasChallenge:true,usedFallback:false,plan:'token=private'}); this.options.onHelloOk(); } async stopAndWait(){} }");
    const {LOOPS_GATEWAY_STARTUP_BUDGET_MS:_timeoutOverride,...env}=process.env;
    const worker=fork(new URL('./helpers/gateway-client-worker.mjs',import.meta.url),[],{cwd:root,env:{...env,LOOPS_GATEWAY_CLIENT_PROJECT_ROOT:root,LOOPS_GATEWAY_URL:'ws://127.0.0.1:21961',LOOPS_GATEWAY_TOKEN:'private-token'},silent:true});
    const messages=[];
    await new Promise((resolveDone,reject)=>{const timer=setTimeout(()=>reject(Error('Worker did not stop.')),5_000);worker.on('message',message=>{messages.push(message);if(message?.type==='ready')worker.send({type:'stop'});});worker.once('error',reject);worker.once('exit',code=>{clearTimeout(timer);if(code===0)resolveDone();else reject(Error(`Worker exited ${code}.`));});});
    expect(messages).toEqual(expect.arrayContaining([{type:'timing',timing:{phase:'challenge',generation:2,durationMs:7,phaseDurationMs:3,hasChallenge:true,usedFallback:false}},{type:'ready'},{type:'stopped'}]));
    expect(messages.filter(message=>message?.type==='startup-milestone').map(message=>[message.phase,message.sequence])).toEqual([['worker-entry',0],['sdk-imported',1],['client-started',2]]);
    expect(messages.findIndex(message=>message?.phase==='client-started')).toBeLessThan(messages.findIndex(message=>message?.type==='ready'));
    expect(JSON.stringify(messages)).not.toContain('private');
  });

  it('distinguishes bounded pre-entry, SDK-import, and post-import stalls using only owned fake workers',async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-client-phases-'));directories.push(root);
    const packageRoot=join(root,'node_modules','openclaw'),preload=join(root,'preload.mjs');mkdirSync(packageRoot,{recursive:true});
    const preGate=join(root,'enter'),importGate=join(root,'import'),helloGate=join(root,'hello');
    writeFileSync(join(root,'package.json'),JSON.stringify({name:'phase-fixture',private:true,type:'module'}));
    writeFileSync(join(packageRoot,'package.json'),JSON.stringify({name:'openclaw',private:true,type:'module',exports:{'./plugin-sdk/gateway-runtime':'./gateway-runtime.mjs'}}));
    const waitSource=file=>`await new Promise((done,reject)=>{let tries=0;const poll=setInterval(()=>{if(existsSync(${JSON.stringify(file)})){clearInterval(poll);done();}else if(++tries===300){clearInterval(poll);reject(Error('fixture gate expired'));}},10);});`;
    writeFileSync(preload,'import {existsSync} from "node:fs"; process.send?.({type:"fixture-preload-entered"}); '+waitSource(preGate));
    writeFileSync(join(packageRoot,'gateway-runtime.mjs'),'import {existsSync} from "node:fs"; '+waitSource(importGate)+' export class GatewayClient { constructor(options){this.options=options;} start(){this.poll=setInterval(()=>{if(existsSync('+JSON.stringify(helloGate)+')){clearInterval(this.poll);this.options.onHelloOk();}},10);} async stopAndWait(){clearInterval(this.poll);} }');
    const worker=fork(new URL('./helpers/gateway-client-worker.mjs',import.meta.url),[],{cwd:root,execArgv:['--import',preload],env:{PATH:process.env.PATH??'/usr/bin:/bin',LOOPS_GATEWAY_CLIENT_PROJECT_ROOT:root,LOOPS_GATEWAY_URL:'ws://127.0.0.1:21961',LOOPS_GATEWAY_TOKEN:'private-token'},silent:true});
    const messages=[];let milestones=[];
    const started=Date.now();
    worker.on('message',message=>{messages.push(message);if(message?.type==='startup-milestone')milestones=appendLifecycleClientMilestone(milestones,message,Date.now()-started);});
    const until=async(predicate,label)=>{for(let attempt=0;attempt<300;attempt++){if(predicate())return;await new Promise(done=>setTimeout(done,10));}throw Error('Fixture timed out waiting for '+label);};
    try{
      await until(()=>messages.some(message=>message?.type==='fixture-preload-entered'),'pre-entry fixture gate');
      await new Promise(done=>setTimeout(done,80));
      expect(milestones).toEqual([]); // The parent spawned it, but worker entry was not observed.
      writeFileSync(preGate,'go');await until(()=>milestones.length===1,'worker entry');
      expect(milestones[0].phase).toBe('worker-entry');
      await new Promise(done=>setTimeout(done,80));expect(milestones).toHaveLength(1); // SDK import is held.
      writeFileSync(importGate,'go');await until(()=>milestones.length===3,'client start');
      expect(milestones.map(value=>value.phase)).toEqual(['worker-entry','sdk-imported','client-started']);
      expect(messages.some(message=>message?.type==='ready')).toBe(false); // Client start precedes hello.
      writeFileSync(helloGate,'go');await until(()=>messages.some(message=>message?.type==='ready'),'hello');
      worker.send({type:'stop'});await until(()=>worker.exitCode!==null||worker.signalCode!==null,'owned worker exit');
      expect(worker.exitCode).toBe(0);
      expect(milestones.every(value=>value.workerElapsedMs<=value.receivedElapsedMs)).toBe(true);
      expect(JSON.stringify(messages)).not.toContain('private-token');
    }finally{
      for(const gate of [preGate,importGate,helloGate])if(!existsSync(gate))writeFileSync(gate,'go');
      if(worker.exitCode===null&&worker.signalCode===null){worker.kill('SIGTERM');await until(()=>worker.exitCode!==null||worker.signalCode!==null,'terminated worker');}
    }
  },7000);

  it('classifies an unspawned child before alive and preserves live, exit, and signal states',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'loops-child-state-'));directories.push(directory);
    const failed=spawn(join(directory,'missing-worker-command'));await new Promise(resolveDone=>failed.once('error',resolveDone));
    expect(lifecycleChildProcessState(failed)).toBe('unavailable');
    const live=spawn(process.execPath,['--input-type=module','--eval','setInterval(()=>{},1000)'],{stdio:'ignore'});
    expect(lifecycleChildProcessState(live)).toBe('alive');live.kill('SIGTERM');await new Promise(resolveDone=>live.once('exit',resolveDone));
    expect(lifecycleChildProcessState(live)).toBe('signaled');
    const exited=spawn(process.execPath,['--input-type=module','--eval','process.exit(0)'],{stdio:'ignore'});await new Promise(resolveDone=>exited.once('exit',resolveDone));
    expect(lifecycleChildProcessState(exited)).toBe('exited');
  });

  it('records bounded active and completed operations without reading hostile getters',()=>{
    const secret='private-operation-secret';
    const diagnostics={completedOperations:[{operation:'installer',outcome:'completed',elapsedMs:19},{operation:'sdk-client-startup',outcome:'failed',elapsedMs:99_999_999}],cleanupError:Object.assign(new Error('cleanup'),{code:'ETIMEDOUT'}),cleanup:{operation:'gateway-shutdown',outcome:'failed',elapsedMs:44}};Object.defineProperty(diagnostics,'operation',{get(){throw Error(secret);}});Object.defineProperty(diagnostics,'elapsedMs',{get(){throw Error(secret);}});
    const receipt=lifecycleFailureReceipt('upgrade',Object.assign(new Error('primary'),{code:'ECONNREFUSED'}),undefined,undefined,diagnostics);
    expect(receipt).toMatchObject({category:'connection',activeOperation:{operation:'unknown',outcome:'failed',elapsedMs:0},completedOperations:[{operation:'installer',outcome:'completed',elapsedMs:19}],cleanupFailure:{operation:'gateway-shutdown',outcome:'failed',elapsedMs:44,category:'timeout'}});
    expect(JSON.stringify(receipt)).not.toContain(secret);
  });

  it('recognizes a connection code after a child runtime failure is wrapped at the lifecycle boundary',()=>{
    let runtimeError;
    try{execFileSync(process.execPath,['--input-type=module','--eval',"throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1'),{code:'ECONNREFUSED'})"],{stdio:'pipe'});}catch(error){runtimeError=error;}
    expect(runtimeError).toMatchObject({status:1});
    const wrapped=new Error(`Gateway client failed: ${runtimeError.stderr}`);
    expect(lifecycleFailureReceipt('upgrade',wrapped)).toEqual({status:'failed',phase:'upgrade',category:'connection',message:'A lifecycle connection failed.'});
  });

  it('writes a sanitized receipt when lifecycle archive preflight fails',()=>{
    const directory=mkdtempSync(join(tmpdir(),'loops-lifecycle-preflight-'));directories.push(directory);
    const result=spawnSync(process.execPath,[new URL('../scripts/verify-package-lifecycle.mjs',import.meta.url).pathname,join(directory,'missing-previous.tgz'),join(directory,'missing-current.tgz')],{encoding:'utf8',env:{...process.env,LOOPS_EVIDENCE_DIR:directory,LOOPS_LIFECYCLE_PREVIOUS_REF:'7b2705bc2068f09e68e738ae199889feb69c1680',LOOPS_LIFECYCLE_PREVIOUS_HOST_ROOT:directory}});
    expect(result.status).toBe(1);
    expect(JSON.parse(readFileSync(join(directory,'package-lifecycle','receipt.json'),'utf8'))).toMatchObject({status:'failed',phase:'archive-validation',category:'required-file-missing',message:'A required lifecycle file was unavailable.',activeOperation:{operation:'archive-validation',outcome:'failed',phase:'archive-validation'},completedOperations:[],artifacts:{previous:{source:'7b2705bc2068f09e68e738ae199889feb69c1680',sha256:'unknown',hostVersion:'unknown'},current:{sha256:'unknown',hostVersion:'unknown'}}});
  });

  it('retains private diagnostics when required lifecycle arguments are missing',()=>{
    const directory=mkdtempSync(join(tmpdir(),'loops-lifecycle-arguments-'));directories.push(directory);
    const result=spawnSync(process.execPath,[new URL('../scripts/verify-package-lifecycle.mjs',import.meta.url).pathname],{cwd:directory,encoding:'utf8',env:{...process.env,LOOPS_EVIDENCE_DIR:directory}});
    expect(result.status).toBe(1);
    expect(JSON.parse(readFileSync(join(directory,'package-lifecycle','receipt.json'),'utf8'))).toMatchObject({status:'failed',phase:'archive-validation',category:'invariant'});
    const privateDirectory=readdirSync(join(directory,'.dev-profile'),{withFileTypes:true}).find(entry=>entry.isDirectory()&&entry.name.startsWith('package-lifecycle-evidence-'));
    expect(privateDirectory).toBeDefined();
    expect(readFileSync(join(directory,'.dev-profile',privateDirectory.name,'failure.txt'),'utf8')).toContain('Usage: node scripts/verify-package-lifecycle.mjs');
  });

  it('reports accurately when private argument diagnostics cannot be retained',()=>{
    const directory=mkdtempSync(join(tmpdir(),'loops-lifecycle-private-unavailable-'));directories.push(directory);
    writeFileSync(join(directory,'.dev-profile'),'not a directory');
    const result=spawnSync(process.execPath,[new URL('../scripts/verify-package-lifecycle.mjs',import.meta.url).pathname],{cwd:directory,encoding:'utf8',env:{...process.env,LOOPS_EVIDENCE_DIR:directory}});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('private diagnostic evidence could not be retained');
    expect(JSON.parse(readFileSync(join(directory,'package-lifecycle','receipt.json'),'utf8'))).toMatchObject({status:'failed',phase:'archive-validation',category:'invariant'});
  });

  it('keeps the sanitized receipt in the always-uploaded artifact allowlist without private evidence',()=>{
    const workflow=readFileSync(new URL('../.github/workflows/verify.yml',import.meta.url),'utf8');
    const upload=workflow.slice(workflow.indexOf('- uses: actions/upload-artifact'));
    expect(upload).toContain('if: always()');
    expect(upload).toContain('evidence/ci/package-lifecycle/receipt.json');
    expect(upload).not.toMatch(/failure\.txt|\.dev-profile|package-lifecycle-evidence-/);
  });
});
