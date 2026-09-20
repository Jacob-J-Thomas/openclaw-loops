import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {lifecycleFailureReceipt} from '../scripts/lifecycle-failure-receipt.mjs';

const directories=[];
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});

describe('sanitized lifecycle failure receipt',()=>{
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
    const source=`import {writeLifecycleFailureReceipt} from ${JSON.stringify(moduleUrl)};\ntry { const error=Object.assign(new Error(${JSON.stringify(secret)}),{status:17,stderr:${JSON.stringify(secret)}}); throw error; } catch(error) { writeLifecycleFailureReceipt(process.env.RECEIPT_DIR,'uninstall-reinstall',error); process.exitCode=17; }`;
    const child=spawnSync(process.execPath,['--input-type=module','--eval',source],{encoding:'utf8',env:{...process.env,RECEIPT_DIR:directory}});
    expect(child.status).toBe(17);
    const text=readFileSync(join(directory,'receipt.json'),'utf8');
    expect(JSON.parse(text)).toEqual({status:'failed',phase:'uninstall-reinstall',category:'subprocess-exit',message:'A lifecycle subprocess exited unsuccessfully.'});
    expect(text).not.toContain(secret);
    expect(text).not.toMatch(/token|profile|config|stderr|stack|path/i);
  });

  it('replaces an unrecognized phase instead of serializing caller-controlled text',()=>{
    expect(lifecycleFailureReceipt('secret phase value',{message:'private'})).toEqual({status:'failed',phase:'unknown',category:'unexpected',message:'Lifecycle verification failed unexpectedly.'});
  });

  it('recognizes a connection code after a child runtime failure is wrapped at the lifecycle boundary',()=>{
    let runtimeError;
    try{execFileSync(process.execPath,['--input-type=module','--eval',"throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1'),{code:'ECONNREFUSED'})"],{stdio:'pipe'});}catch(error){runtimeError=error;}
    expect(runtimeError).toMatchObject({status:1});
    const wrapped=new Error(`Gateway client failed: ${runtimeError.stderr}`);
    expect(lifecycleFailureReceipt('upgrade',wrapped)).toEqual({status:'failed',phase:'upgrade',category:'connection',message:'A lifecycle connection failed.'});
  });

  it('keeps the sanitized receipt in the always-uploaded artifact allowlist without private evidence',()=>{
    const workflow=readFileSync(new URL('../.github/workflows/verify.yml',import.meta.url),'utf8');
    const upload=workflow.slice(workflow.indexOf('- uses: actions/upload-artifact'));
    expect(upload).toContain('if: always()');
    expect(upload).toContain('evidence/ci/package-lifecycle/receipt.json');
    expect(upload).not.toMatch(/failure\.txt|\.dev-profile|package-lifecycle-evidence-/);
  });
});
