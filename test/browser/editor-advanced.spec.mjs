import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

const root=resolve(import.meta.dirname,'../..');
const budgets={definitionBytes:4194304,inputBytes:1048576,promptBytes:1048576,defaultOutputBytes:1048576,defaultExecutions:1000,defaultRepeat:3};
const parameters=[
  {key:'temperature',label:'Temperature',type:'number',support:'advisory',reason:'Synthetic browser transport.',minimum:0},
  {key:'maxTokens',label:'Output tokens',type:'integer',support:'advisory',reason:'Synthetic browser transport.',minimum:1},
];

function harness(){return `
  import React from 'react'; import {createRoot} from 'react-dom/client'; import {Editor} from './src/editor.tsx';
  const parameters=${JSON.stringify(parameters)}, budgets=${JSON.stringify(budgets)};
  const clone=value=>structuredClone(value), listeners=new Set(), records=new Map(), calls=[];
  const record=definition=>({definition,enabledRevision:null,publishedRevision:null,grants:definition.capabilities,revisions:{[definition.revision]:clone(definition)}});
  const emit=()=>listeners.forEach(listener=>listener({}));
  const page=()=>({items:[...records.values()].filter(item=>!item.archived&&!item.deletedAt).map(item=>({id:item.definition.id,slug:item.definition.slug,name:item.definition.name,description:item.definition.description,revision:item.definition.revision,enabledRevision:item.enabledRevision,publishedRevision:item.publishedRevision,hasDraft:item.publishedRevision!==item.definition.revision,capabilities:item.definition.capabilities,archived:false})),nextCursor:null,total:records.size,offset:0});
  const save=(definition,enabled,mode)=>{let item=records.get(definition.id);const revision=(item?.definition.revision??0)+1;const next={...clone(definition),revision};if(!item)item=record(next);else {item.definition=next;item.revisions={...item.revisions,[revision]:clone(next)};}if(enabled){item.enabledRevision=revision;item.publishedRevision=revision;} records.set(next.id,item);calls.push({mode,definition:clone(next),enabled:item.enabledRevision,published:item.publishedRevision});emit();return {record:clone(item),issues:[]};};
  const action=async(id,payload)=>{calls.push({id,payload:clone(payload)});if(id==='capabilities')return {model:'fake/default',runtime:'synthetic browser transport',configured:true,authorized:true,available:true,parameters,budgets,concurrency:1,notes:['No provider was called.']};if(id==='browse')return page();if(id==='history')return {items:[],nextCursor:null,total:0};if(id==='load'){if(!records.has(payload.id))throw Error('Loop not found.');return clone(records.get(payload.id));}if(id==='save')return save(payload.definition,payload.enabled===true,'save');if(id==='draft')return save(payload.definition,false,'draft');if(id==='publish'){const item=records.get(payload.id);item.enabledRevision=payload.revision;item.publishedRevision=payload.revision;calls.push({mode:'publish',revision:payload.revision});emit();return clone(item);}if(id==='enable'){const item=records.get(payload.id);item.enabledRevision=payload.enabled?payload.revision:null;emit();return clone(item);}if(id==='restore'){const item=records.get(payload.id), base=clone(item.revisions[payload.revision]);return save({...base,id:item.definition.id,slug:item.definition.slug},false,'restore');}throw Error('Unhandled browser transport operation: '+id);};
  const session={key:'agent:main:editor-browser',agentId:'main',label:'Editor browser regression'};
  const host={apiVersion:1,pluginId:'loops-poc',signal:new AbortController().signal,basePath:'/',locale:'en',redact:text=>text,connection:{connected:true},components:{},request:async(_method,params)=>({ok:true,result:await action(params.actionId,params.payload)}),onEvent:(event,listener)=>{if(event==='plugin.loops-poc.changed'){listeners.add(listener);return ()=>listeners.delete(listener);}return ()=>{};},subscribe:()=>()=>{},sessions:{rows:[session],selectedKey:session.key,normalizeKey:key=>key,refresh:async()=>{},observe:(_query,listener)=>{listener({result:{sessions:[session]}});return {dispose:()=>{}};},open:()=>{},create:async()=>session.key,patch:async()=>{}},agents:{rows:[{id:'main',name:'Main'}],selectedId:'main',defaultId:'main',scopeId:null,select:()=>{},setScope:()=>{},refresh:async()=>{}},navigation:{openPage:()=>{},pageHref:()=>''},ui:{invalidate:()=>{},registerPage:()=>()=>{},registerNavigation:()=>()=>{},registerPanel:()=>()=>{},registerAction:()=>()=>{},registerAccessory:()=>()=>{},registerWidget:()=>()=>{},registerReplacement:()=>()=>{},selectReplacement:()=>{}}};
  globalThis.__editorRegression={calls,records}; createRoot(document.getElementById('app')).render(React.createElement(Editor,{host}));
`}

async function serve(html){
  const server=createServer((request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,url:`http://127.0.0.1:${server.address().port}`};
}
const waitFor=async(page,selector)=>page.locator(selector).waitFor({state:'visible',timeout:10_000});

export async function runEditorAdvancedRegression({receiptPath}={}){
  const bundle=await build({stdin:{contents:harness(),resolveDir:root,loader:'ts'},bundle:true,format:'iife',platform:'browser',write:false,target:'es2022'});
  const {server,url}=await serve(`<!doctype html><html><body><div id="app"></div><script>${bundle.outputFiles[0].text}</script></body></html>`);
  let browser; let importDirectory;
  const receipt={runner:'mounted-production-editor-playwright',transport:'synthetic fake backend; no provider invoked',checks:[],errors:[]};
  try {
    browser=await chromium.launch({headless:true}); const page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.setDefaultTimeout(10_000);page.on('pageerror',error=>receipt.errors.push(error.message));
    await page.goto(url); await waitFor(page,'select[aria-label="Load an example"]');
    await page.selectOption('select[aria-label="Load an example"]','summarize-text');
    await page.selectOption('select[aria-label="Select node to edit"]','summary');
    await page.locator('details.lp-advanced summary').click();
    const temperature=page.getByLabel(/^Temperature/), maxTokens=page.getByLabel(/^Output tokens/);
    assert.equal(await temperature.inputValue(),''); assert.equal(await maxTokens.inputValue(),'');receipt.checks.push('inherit omits overrides');
    await temperature.fill('0'); assert.equal(await temperature.inputValue(),'0'); receipt.checks.push('explicit temperature zero');
    await maxTokens.fill('64');
    await page.getByRole('textbox',{name:'Model',exact:true}).fill('fake/switched'); assert.equal(await temperature.inputValue(),'0'); assert.equal(await maxTokens.inputValue(),'64'); receipt.checks.push('model switch preserves explicit overrides');
    await page.getByRole('button',{name:'Save & publish'}).click(); await waitFor(page,'text=Revision 1 saved and enabled for chat and UI.');
    await page.getByRole('button',{name:'Reset temperature'}).click(); assert.equal(await temperature.inputValue(),'');
    await page.getByRole('button',{name:'Save draft'}).click(); await waitFor(page,'text=Revision 2 saved as a draft'); receipt.checks.push('single Advanced reset');
    await temperature.fill('0'); await maxTokens.fill('96');
    await page.getByRole('button',{name:'Reset all Advanced settings'}).click(); assert.equal(await temperature.inputValue(),'');
    await page.getByRole('button',{name:'Save draft'}).click(); await waitFor(page,'text=Revision 3 saved as a draft'); receipt.checks.push('all Advanced reset');
    await temperature.fill('0'); await maxTokens.fill('96');
    await page.getByRole('button',{name:'Save & publish'}).click(); await waitFor(page,'text=Revision 4 saved and enabled for chat and UI.'); receipt.checks.push('model switch and publication');
    const download=page.waitForEvent('download'); await page.getByRole('button',{name:'Export'}).click(); const exported=await download; const exportedPath=await exported.path(); assert.ok(exportedPath,'Export must create a file.');
    const exportedDefinition=JSON.parse(await (await import('node:fs/promises')).readFile(exportedPath,'utf8')); assert.equal(exportedDefinition.nodes.find(node=>node.id==='summary').advanced.temperature,0); receipt.checks.push('export');
    await page.locator('details.lp-versions summary').click(); await page.selectOption('details.lp-versions select','1');
    await page.getByRole('button',{name:'Restore as draft'}).click(); await page.getByRole('button',{name:'Publish r5',exact:true}).waitFor(); await page.selectOption('select[aria-label="Select node to edit"]','summary');
    assert.equal(await temperature.inputValue(),'0'); assert.equal(await maxTokens.inputValue(),'64'); receipt.checks.push('restore preserves publication');
    await page.getByRole('button',{name:'Clone loop'}).click(); await page.selectOption('select[aria-label="Select node to edit"]','summary'); await page.getByRole('button',{name:'Save & publish'}).click(); await waitFor(page,'text=Revision 1 saved and enabled for chat and UI.'); receipt.checks.push('clone');
    importDirectory=await mkdtemp(join(tmpdir(),'loops-editor-import-')); const fixturePath=join(importDirectory,'definition.json'); await writeFile(fixturePath,JSON.stringify({...exportedDefinition,id:'imported-editor',slug:'imported-editor'}));
    const chooserEvent=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Import',exact:true}).click();await (await chooserEvent).setFiles(fixturePath); await waitFor(page,'text=New loop. Choose Save & publish'); await page.getByRole('button',{name:'Save draft'}).click(); await waitFor(page,'text=Revision 1 saved as a draft'); receipt.checks.push('import');
    const state=await page.evaluate(()=>({calls:globalThis.__editorRegression.calls,records:[...globalThis.__editorRegression.records.entries()]})); const advanced=definition=>definition.nodes.find(node=>node.id==='summary').advanced;
    assert.equal(state.records[0][1].definition.nodes.find(node=>node.id==='summary').model,'fake/switched');
    const saved=state.calls.filter(call=>['save','draft','restore'].includes(call.mode)); assert.deepEqual(advanced(saved.find(call=>call.mode==='save'&&call.definition.revision===1).definition),{temperature:0,maxTokens:64}); assert.deepEqual(advanced(saved.find(call=>call.mode==='save'&&call.definition.revision===4).definition),{temperature:0,maxTokens:96});
    assert.deepEqual(advanced(saved.find(call=>call.mode==='restore').definition),{temperature:0,maxTokens:64}); assert.deepEqual(advanced(state.records.find(([,item])=>item.definition.slug.startsWith('imported-editor-'))[1].definition),{temperature:0,maxTokens:96}); assert.equal(state.records[0][1].publishedRevision,4);assert.equal(state.records[0][1].enabledRevision,4);assert.deepEqual(advanced(saved.find(call=>call.definition.revision===2).definition),{maxTokens:64});assert.ok(!Object.hasOwn(saved.find(call=>call.definition.revision===3).definition.nodes.find(node=>node.id==='summary'),'advanced'));assert.deepEqual(state.records[1][1].definition.nodes,state.records[0][1].definition.nodes);assert.deepEqual(state.records[1][1].definition.edges,state.records[0][1].definition.edges);assert.deepEqual(receipt.errors,[]);assert.equal(await page.getByRole('alert').count(),0);
    receipt.definitions=state.records.map(([id,item])=>({id,revision:item.definition.revision,enabledRevision:item.enabledRevision,publishedRevision:item.publishedRevision,advanced:advanced(item.definition)}));
    receipt.operations=state.calls.filter(call=>call.mode||call.id).map(call=>call.mode??call.id); receipt.passed=true;
  } catch(error){receipt.failure=error.message;if(receiptPath)await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n');throw error;} finally { await browser?.close(); if(importDirectory)await rm(importDirectory,{recursive:true,force:true}); await new Promise(resolve=>server.close(resolve)); }
  if(receiptPath)await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n'); return receipt;
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await runEditorAdvancedRegression(),null,2));
