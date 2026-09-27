import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';

const root=resolve(import.meta.dirname,'../..');
const fixture=`
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {RunLauncher} from './src/run-launcher.tsx';
  const baseDefinition={id:'artifact-input',revision:1,slug:'artifact-input',inputSchema:[{name:'file',label:'File',type:'artifact',required:true}]};
  const calls=[],pendingStages=[],pendingReleases=[],captured=[];
  let nextId=0,deferStage=false,deferRelease=false,failRelease=false,runMode='fast',pageSize=100;
  const makeReference=owner=>{const number=++nextId,reference={kind:'loops-artifact',id:'capture-'+number,runId:'capture-op-'+number,nodeId:'upload',ownerScope:owner,sha256:'a'.repeat(64),mediaType:'text/plain',bytes:1,createdAt:'2026-09-26T00:00:00.000Z',expiresAt:'2026-10-26T00:00:00.000Z'};captured.push({reference,owner,status:'published'});return reference;};
  function App(){
    const [owner,setOwner]=React.useState('owner-a'),[error,setError]=React.useState(''),[schema,setSchema]=React.useState('base'),[loop,setLoop]=React.useState('artifact-input');
    const inputSchema=schema==='extra'?[...baseDefinition.inputSchema,{name:'note',label:'Note',type:'text',required:false}]:schema==='text'?[{name:'file',label:'File text',type:'text',required:true}]:schema==='removed'?[{name:'note',label:'Note',type:'text',required:false}]:baseDefinition.inputSchema;
    const definition={...baseDefinition,id:loop,inputSchema};
    const stage=async file=>{calls.push({kind:'capture',owner,name:file.name});if(deferStage){deferStage=false;return new Promise((resolve,reject)=>pendingStages.push({resolve,reject,owner}));}return makeReference(owner);};
    const release=async reference=>{calls.push({kind:'release',owner,id:reference.id,runId:reference.runId});if(failRelease){failRelease=false;throw Error('release acknowledgement uncertain');}if(deferRelease){deferRelease=false;return new Promise((resolve,reject)=>pendingReleases.push({resolve,reject,reference}));}const item=captured.find(item=>item.reference.id===reference.id&&item.owner===owner);if(item?.everLinked)return 'linked-protected';if(item)item.status='released';return 'released';};
    const list=async cursor=>{const rows=captured.filter(item=>item.owner===owner),offset=Number(cursor)||0;return {items:rows.slice(offset,offset+pageSize).map(item=>({reference:item.reference,status:item.status,everLinked:Boolean(item.everLinked),operationId:item.reference.runId.slice('capture-'.length)})),nextCursor:offset+pageSize<rows.length?String(offset+pageSize):null};};
    const run=async request=>{calls.push({kind:'run',owner,input:request.input});if(runMode==='reject')throw Error('run rejected');};
    globalThis.__probe={calls,pendingStages,pendingReleases,deferStage:()=>{deferStage=true;},deferRelease:()=>{deferRelease=true;},failRelease:()=>{failRelease=true;},setRunMode:value=>{runMode=value;},setPageSize:value=>{pageSize=value;},setOwner,setSchema,setLoop,markLinked:id=>{const item=captured.find(item=>item.reference.id===id);if(item)item.everLinked=true;},resolveStage:()=>{const pending=pendingStages.shift();if(!pending)throw Error('No pending capture.');pending.resolve(makeReference(pending.owner));},resolveRelease:()=>{const pending=pendingReleases.shift();if(!pending)throw Error('No pending release.');const item=captured.find(item=>item.reference.id===pending.reference.id);if(item)item.status='released';pending.resolve('released');}};
    return React.createElement(React.Fragment,null,
      React.createElement('p',{'data-testid':'owner'},owner),
      React.createElement('p',{role:'alert'},error),
      React.createElement(RunLauncher,{key:owner+':'+loop,draft:definition,published:null,enabled:false,dirty:false,invalid:false,busy:false,authorized:true,
        onRun:run,onStageFile:stage,onReleaseFile:release,onListFiles:list,onError:reason=>setError(reason instanceof Error?reason.message:String(reason))}));
  }
  createRoot(document.getElementById('app')).render(React.createElement(React.StrictMode,null,React.createElement(App)));
`;

async function serve(html){
  const server=createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,url:`http://127.0.0.1:${server.address().port}`};
}

const file=(name)=>({name,mimeType:'text/plain',buffer:Buffer.from(name)});
const count=(page,kind)=>page.evaluate(kind=>globalThis.__probe.calls.filter(call=>call.kind===kind).length,kind);
async function sha256(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}

export async function verifyMountedLauncherCustody(){
  const bundle=await build({stdin:{contents:fixture,resolveDir:root,loader:'tsx'},bundle:true,format:'iife',platform:'browser',write:false,target:'es2022'});
  const {server,url}=await serve(`<!doctype html><html><body><div id="app"></div><script>${bundle.outputFiles[0].text}</script></body></html>`);
  const checks=[],errors=[],browserProfile=await mkdtemp(join(tmpdir(),'loops-launcher-custody-'));let browser;
  try{
    const executable=chromium.executablePath(),executableSha256=await sha256(executable);
    browser=await chromium.launchPersistentContext(browserProfile,{headless:true});
    const open=async()=>{const page=await browser.newPage();page.setDefaultTimeout(10_000);page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.getByLabel('Choose file for File').waitFor();return page;};
    {
      const page=await open();await page.evaluate(()=>globalThis.__probe.deferStage());
      await page.evaluate(()=>{const input=globalThis.document.querySelector('input[type="file"]'),transfer=new globalThis.DataTransfer();transfer.items.add(new globalThis.File(['first.txt'],'first.txt',{type:'text/plain'}));input.files=transfer.files;input.dispatchEvent(new globalThis.Event('change',{bubbles:true}));globalThis.document.querySelector('.lp-run-button').click();});
      await page.waitForFunction(()=>globalThis.__probe.pendingStages.length===1);
      assert.equal(await count(page,'run'),0);
      assert.equal(await page.getByRole('button',{name:'Test current draft'}).isDisabled(),true);
      await page.evaluate(()=>globalThis.__probe.resolveStage());
      await page.getByText('Captured and verified: capture-1').waitFor();
      await page.getByRole('button',{name:'Test current draft'}).click();
      await page.waitForFunction(()=>globalThis.__probe.calls.filter(call=>call.kind==='run').length===1);
      await page.getByRole('button',{name:'Test current draft'}).click();
      await page.waitForFunction(()=>globalThis.__probe.calls.filter(call=>call.kind==='run').length===2);
      await page.evaluate(()=>globalThis.__probe.setRunMode('reject'));
      await page.getByRole('button',{name:'Test current draft'}).click();
      await page.getByRole('alert').getByText('run rejected').waitFor();
      await page.getByRole('button',{name:'Test current draft'}).click();
      await page.waitForFunction(()=>globalThis.__probe.calls.filter(call=>call.kind==='run').length===4);
      assert.equal(await count(page,'capture'),1);checks.push('mounted capture blocks Run; fast and rejected Run settle the lock');await page.close();
    }
    {
      const page=await open();await page.getByLabel('Choose file for File').setInputFiles(file('first.txt'));
      await page.getByText('Captured and verified: capture-1').waitFor();
      await page.evaluate(()=>globalThis.__probe.deferRelease());
      await page.getByLabel('Choose file for File').setInputFiles(file('second.txt'));
      await page.waitForFunction(()=>globalThis.__probe.pendingReleases.length===1);
      assert.equal(await count(page,'capture'),1);
      assert.equal(await page.getByRole('button',{name:'Test current draft'}).isDisabled(),true);
      await page.evaluate(()=>globalThis.__probe.resolveRelease());
      await page.getByText('Captured and verified: capture-2').waitFor();
      const actions=await page.evaluate(()=>globalThis.__probe.calls.map(call=>call.kind+':'+(call.id??call.name)));
      assert.deepEqual(actions,['capture:first.txt','release:capture-1','capture:second.txt']);
      checks.push('mounted replacement waits for exact prior release before next capture');await page.close();
    }
    {
      const page=await open();await page.evaluate(()=>globalThis.__probe.deferStage());
      await page.getByLabel('Choose file for File').setInputFiles(file('late-ok.txt'));
      await page.waitForFunction(()=>globalThis.__probe.pendingStages.length===1);
      await page.evaluate(()=>globalThis.__probe.setOwner('owner-b'));
      await page.getByTestId('owner').filter({hasText:'owner-b'}).waitFor();
      await page.evaluate(()=>globalThis.__probe.resolveStage());
      await page.waitForFunction(()=>globalThis.__probe.calls.some(call=>call.kind==='release'));
      assert.equal(await page.getByText('Captured and verified: capture-1').count(),0);
      assert.deepEqual(await page.evaluate(()=>globalThis.__probe.calls.filter(call=>call.kind==='release').map(call=>[call.owner,call.id])),[['owner-a','capture-1']]);
      checks.push('mounted remount releases late capture through old owner and never selects it');await page.close();
    }
    {
      const page=await open();await page.evaluate(()=>globalThis.__probe.deferStage());
      await page.getByLabel('Choose file for File').setInputFiles(file('late.txt'));
      await page.waitForFunction(()=>globalThis.__probe.pendingStages.length===1);
      await page.evaluate(()=>{globalThis.__probe.failRelease();globalThis.__probe.setOwner('owner-b');});
      await page.getByTestId('owner').filter({hasText:'owner-b'}).waitFor();
      await page.evaluate(()=>globalThis.__probe.resolveStage());
      await page.getByRole('alert').getByText(/Captured file capture-1 \(capture-op-1, owner owner-a\) could not be confirmed released/).waitFor();
      assert.equal(await page.getByText('Captured and verified: capture-1').count(),0);
      const releases=await page.evaluate(()=>globalThis.__probe.calls.filter(call=>call.kind==='release'));
      assert.deepEqual(releases.map(call=>[call.owner,call.id,call.runId]),[['owner-a','capture-1','capture-op-1']]);
      checks.push('mounted old-owner stale capture cleanup failure retains visible custody identity');await page.close();
    }
    {
      const page=await open();await page.getByLabel('Choose file for File').setInputFiles(file('first.txt'));
      await page.getByText('Captured and verified: capture-1').waitFor();
      await page.evaluate(()=>globalThis.__probe.setSchema('extra'));
      assert.equal(await page.getByText('Captured and verified: capture-1').count(),1);
      await page.getByLabel('Choose file for File').setInputFiles(file('second.txt'));
      await page.getByText('Captured and verified: capture-2').waitFor();
      assert.deepEqual(await page.evaluate(()=>globalThis.__probe.calls.map(call=>call.kind+':'+(call.id??call.name))),['capture:first.txt','release:capture-1','capture:second.txt']);
      await page.evaluate(()=>globalThis.__probe.setSchema('text'));
      assert.equal(await page.getByText('Captured and verified: capture-2').count(),0);
      await page.getByRole('button',{name:'Refresh captured files'}).click();
      await page.getByText(/capture-2 \(capture-op-2, owner owner-a\).*published/).waitFor();
      assert.equal(await page.getByRole('textbox',{name:'File text'}).inputValue(),'');
      checks.push('settled file survives compatible schema edit, replacement obeys release order, and type change retains owner custody without injecting a reference into text');await page.close();
    }
    {
      const page=await open();await page.evaluate(()=>globalThis.__probe.deferStage());
      await page.getByLabel('Choose file for File').setInputFiles(file('old-schema.txt'));
      await page.waitForFunction(()=>globalThis.__probe.pendingStages.length===1);
      await page.evaluate(()=>globalThis.__probe.setSchema('extra'));
      await page.evaluate(()=>globalThis.__probe.resolveStage());
      await page.waitForFunction(()=>globalThis.__probe.calls.some(call=>call.kind==='release'));
      assert.equal(await page.getByText('Captured and verified: capture-1').count(),0);
      await page.getByLabel('Choose file for File').setInputFiles(file('new-schema.txt'));
      await page.getByText('Captured and verified: capture-2').waitFor();
      checks.push('genuinely stale in-flight schema capture is released, while a later current-schema capture selects normally');await page.close();
    }
    {
      const page=await open();await page.getByLabel('Choose file for File').setInputFiles(file('settled.txt'));
      await page.getByText('Captured and verified: capture-1').waitFor();
      await page.evaluate(()=>globalThis.__probe.setLoop('second-loop'));
      await page.getByLabel('Choose file for File').waitFor();
      assert.equal(await page.getByText('Captured and verified: capture-1').count(),0);
      await page.getByRole('button',{name:'Refresh captured files'}).click();
      await page.getByText(/capture-1 \(capture-op-1, owner owner-a\).*published/).waitFor();
      await page.getByRole('button',{name:'Release this unused file'}).click();
      await page.getByText(/capture-1 \(capture-op-1, owner owner-a\).*released/).waitFor();
      await page.evaluate(()=>globalThis.__probe.setOwner('owner-b'));
      await page.getByTestId('owner').filter({hasText:'owner-b'}).waitFor();
      await page.getByRole('button',{name:'Refresh captured files'}).click();
      await page.getByText('No captured files on this page.').waitFor();
      checks.push('keyed loop remount exposes settled capture through owner inventory; confirmed release remains visible, and a different owner cannot enumerate it');await page.close();
    }
    {
      const page=await open();await page.getByLabel('Choose file for File').setInputFiles(file('uncertain.txt'));
      await page.getByText('Captured and verified: capture-1').waitFor();
      await page.getByRole('button',{name:'Refresh captured files'}).click();
      await page.evaluate(()=>globalThis.__probe.failRelease());
      await page.getByRole('button',{name:'Release this unused file'}).click();
      await page.getByRole('alert').getByText(/capture-1 \(capture-op-1, owner owner-a\).*release requires inspection/).waitFor();
      assert.equal(await page.getByText('Captured and verified: capture-1').count(),1);
      await page.evaluate(()=>globalThis.__probe.markLinked('capture-1'));
      await page.getByRole('button',{name:'Refresh captured files'}).click();
      await page.getByText(/capture-1 \(capture-op-1, owner owner-a\).*linked to a run/).waitFor();
      assert.equal(await page.getByRole('button',{name:'Release this unused file'}).count(),0);
      await page.getByRole('button',{name:'Release unused file'}).click();
      await page.getByRole('alert').getByText(/capture-1 \(capture-op-1, owner owner-a\) is linked to a run/).waitFor();
      assert.equal(await page.getByText('Captured and verified: capture-1').count(),1);
      checks.push('uncertain release keeps exact identity and selection; linked-protected capture cannot be retired or silently cleared');await page.close();
    }
    {
      const page=await open();await page.getByLabel('Choose file for File').setInputFiles(file('selected.txt'));
      await page.getByText('Captured and verified: capture-1').waitFor();
      await page.getByRole('button',{name:'Refresh captured files'}).click();
      await page.evaluate(()=>globalThis.__probe.deferRelease());
      await page.getByRole('button',{name:'Release this unused file'}).click();
      await page.waitForFunction(()=>globalThis.__probe.pendingReleases.length===1);
      assert.equal(await page.getByRole('button',{name:'Test current draft'}).isDisabled(),true);
      await page.evaluate(()=>globalThis.__probe.resolveRelease());
      await page.getByText(/capture-1 \(capture-op-1, owner owner-a\).*released/).waitFor();
      assert.equal(await page.getByText('Captured and verified: capture-1').count(),0);
      await page.getByRole('button',{name:'Test current draft'}).click();
      await page.getByRole('alert').getByText(/Choose a file for File before running/).waitFor();
      assert.equal(await count(page,'run'),0);
      checks.push('inventory release blocks concurrent Run and clears an exact matching selected file only after acknowledgement');await page.close();
    }
    {
      const page=await open();await page.getByLabel('Choose file for File').setInputFiles(file('first.txt'));
      await page.getByText('Captured and verified: capture-1').waitFor();
      await page.getByLabel('Choose file for File').setInputFiles(file('second.txt'));
      await page.getByText('Captured and verified: capture-2').waitFor();
      await page.evaluate(()=>globalThis.__probe.setPageSize(1));
      await page.getByRole('button',{name:'Refresh captured files'}).click();
      await page.getByText(/capture-1 \(capture-op-1, owner owner-a\).*released/).waitFor();
      await page.getByRole('button',{name:'Next captured files'}).click();
      await page.getByText(/capture-2 \(capture-op-2, owner owner-a\).*published/).waitFor();
      await page.getByRole('button',{name:'Previous captured files'}).click();
      await page.getByText(/capture-1 \(capture-op-1, owner owner-a\).*released/).waitFor();
      checks.push('captured custody pages through historical released records without hiding later live captures');await page.close();
    }
    assert.deepEqual(errors,[]);
    return {runner:'mounted RunLauncher fixture; no OpenClaw service or provider',browserExecutable:executable,browserExecutableSha256:executableSha256,checks,errors};
  }finally{await browser?.close();await rm(browserProfile,{recursive:true,force:true});await new Promise(resolve=>server.close(resolve));}
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){
  verifyMountedLauncherCustody().then(result=>console.log(JSON.stringify(result)),error=>{console.error(error);process.exitCode=1;});
}
