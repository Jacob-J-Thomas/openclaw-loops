import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
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
  import React from 'react'; import {createRoot} from 'react-dom/client'; import {Editor} from './src/editor.tsx'; import {initialContext,applyContextPatch,projectContext} from './src/context.ts'; import {bind} from './src/graph.ts';
  const parameters=${JSON.stringify(parameters)}, budgets=${JSON.stringify(budgets)};
  const clone=value=>structuredClone(value), listeners=new Set(), records=new Map(), calls=[], pendingRuns=new Map(), deferredDrafts=[], deferredLoads=[], deferredChanged=[], sessionListeners=new Set(); let delayDrafts=0,delayLoads=0,localDraftWriteFailures=0,withholdNextDraftChanged=false;
  const record=definition=>({definition,enabledRevision:null,publishedRevision:null,grants:definition.capabilities,revisions:{[definition.revision]:clone(definition)}});
  const emit=()=>listeners.forEach(listener=>listener({}));
  const page=()=>({items:[...records.values()].filter(item=>!item.archived&&!item.deletedAt).map(item=>({id:item.definition.id,slug:item.definition.slug,name:item.definition.name,description:item.definition.description,revision:item.definition.revision,enabledRevision:item.enabledRevision,publishedRevision:item.publishedRevision,hasDraft:item.publishedRevision!==item.definition.revision,capabilities:item.definition.capabilities,archived:false})),nextCursor:null,total:records.size,offset:0});
  const save=(definition,enabled,mode,expectedRevision,notify=true)=>{let item=records.get(definition.id);if(expectedRevision!==undefined&&expectedRevision!==(item?.definition.revision??0))throw Error('revision changed');const revision=(item?.definition.revision??0)+1;const next={...clone(definition),revision};if(!item)item=record(next);else {item.definition=next;item.revisions={...item.revisions,[revision]:clone(next)};}if(enabled){item.enabledRevision=revision;item.publishedRevision=revision;} records.set(next.id,item);calls.push({mode,definition:clone(next),enabled:item.enabledRevision,published:item.publishedRevision});if(notify)emit();else {deferredChanged.push(emit);calls.push({mode:'changed-withheld',definitionId:next.id,revision});}return {record:clone(item),issues:[]};};
  const runReceipt=run=>({id:run.id,state:run.state,owner:run.owner,source:run.source,definition:{id:run.definition.id,slug:run.definition.slug,name:run.definition.name,revision:run.definition.revision},executions:run.executions,createdAt:run.createdAt,updatedAt:run.updatedAt,models:[],pending:run.pending,steps:[],inspection:'Synthetic mounted-browser checkpoint receipt.'});
  const addPendingRun=(id,state,pending)=>{const definition=clone([...records.values()][0].definition),at='2026-09-21T18:00:00.000Z',sessionKey='agent:main:editor-browser';pendingRuns.set(id,{id,requestKey:id,requestFingerprint:id,owner:{agentId:'main',sessionKey,sessionId:sessionKey},source:'session-action',definition,input:{},state,cursor:definition.nodes[0].id,outputs:{},trace:[],executions:0,activeMs:0,createdAt:at,updatedAt:at,pending});emit();};
  const addTypedContextRun=id=>{const definition=clone([...records.values()][0].definition),at='2026-09-21T18:00:00.000Z',sessionKey='agent:main:editor-browser',input={text:'fixture'},summary=definition.nodes.find(node=>node.id==='summary'),returned=definition.nodes.find(node=>node.id==='return');if(!summary?.context||!returned?.context)throw Error('Context fixture requires authored Summary and Return policies.');const context=applyContextPatch(initialContext(input),summary.id,summary.context,0,value=>bind(value,{input,nodes:{summary:0}}),()=> 'b'.repeat(64)),result=bind(returned.value,{input,nodes:{summary:0},context:projectContext(context,returned.context)});pendingRuns.set(id,{id,requestKey:id,requestFingerprint:id,owner:{agentId:'main',sessionKey,sessionId:sessionKey},source:'session-action',definition,input,state:'completed',cursor:'return',outputs:{summary:0,return:result},trace:[],executions:3,activeMs:0,createdAt:at,updatedAt:at,result,context});emit();};
  const addTypedRouteRun=(id,route)=>{const original=clone([...records.values()][0].definition),at='2026-09-21T18:00:00.000Z',sessionKey='agent:main:editor-browser',definition={...original,schemaVersion:3,nodes:[{id:'input',kind:'input',label:'Input'},{id:'condition',kind:'condition',label:'Typed Condition',predicate:{left:'{{input.choice}}',op:'equals',right:'null'},condition:{value:'{{input.choice}}',operator:'missing'}},{id:'yes',kind:'return',label:'Yes',value:{literalJson:'true'}},{id:'no',kind:'return',label:'No',value:{literalJson:'false'}}],edges:[{id:'in',source:'input',target:'condition',port:'next'},{id:'yes-edge',source:'condition',target:'yes',port:'true'},{id:'no-edge',source:'condition',target:'no',port:'false'}],layout:{input:{x:0,y:0},condition:{x:240,y:0},yes:{x:480,y:0},no:{x:480,y:200}}},passed=route.port==='true';pendingRuns.set(id,{id,requestKey:id,requestFingerprint:id,owner:{agentId:'main',sessionKey,sessionId:sessionKey},source:'session-action',definition,input:{},state:'completed',cursor:'condition',outputs:{condition:{value:passed}},trace:[{nodeId:'condition',kind:'condition',state:'completed',startedAt:at,endedAt:at,output:JSON.stringify({value:passed}),route}],executions:2,activeMs:0,createdAt:at,updatedAt:at,result:passed});emit();};
  const action=async(id,payload)=>{calls.push({id,payload:clone(payload)});if(id==='capabilities')return {model:'fake/default',runtime:'synthetic browser transport',configured:true,authorized:true,available:true,parameters,budgets,concurrency:1,notes:['No provider was called.']};if(id==='browse')return page();if(id==='history'){const items=[...pendingRuns.values()].map(run=>({id:run.id,slug:run.definition.slug,revision:run.definition.revision,state:run.state,createdAt:run.createdAt,updatedAt:run.updatedAt,executions:run.executions}));return {items,nextCursor:null,total:items.length};}if(id==='inspect')return clone(pendingRuns.get(payload.runId));if(id==='resume'||id==='review')return runReceipt(pendingRuns.get(payload.runId));if(id==='load'){if(delayLoads){delayLoads--;return new Promise((resolve,reject)=>deferredLoads.push({payload,resolve,reject}));}if(!records.has(payload.id))throw Error('Loop not found.');return clone(records.get(payload.id));}if(id==='save')return save(payload.definition,payload.enabled===true,'save',payload.expectedRevision);if(id==='draft'){if(delayDrafts){delayDrafts--;return new Promise((resolve,reject)=>deferredDrafts.push({payload,resolve,reject}));}return save(payload.definition,false,'draft',payload.expectedRevision);}if(id==='publish'){const item=records.get(payload.id);item.enabledRevision=payload.revision;item.publishedRevision=payload.revision;calls.push({mode:'publish',revision:payload.revision});emit();return clone(item);}if(id==='enable'){const item=records.get(payload.id);item.enabledRevision=payload.enabled?payload.revision:null;emit();return clone(item);}if(id==='restore'){const item=records.get(payload.id), base=clone(item.revisions[payload.revision]);return save({...base,id:item.definition.id,slug:item.definition.slug},false,'restore');}throw Error('Unhandled browser transport operation: '+id);};
  const sessions=[{key:'agent:main:editor-browser',agentId:'main',label:'Editor browser regression'},{key:'agent:main:editor-browser-2',agentId:'main',label:'Second main conversation'},{key:'agent:other:editor-browser',agentId:'other',label:'Other editor scope'}]; let visibleSessions=sessions;
  const publishSessions=()=>sessionListeners.forEach(listener=>listener({result:{sessions:visibleSessions}}));
  const host={apiVersion:1,pluginId:'loops-poc',signal:new AbortController().signal,basePath:'/',locale:'en',redact:text=>text,connection:{connected:true},components:{},request:async(_method,params)=>({ok:true,result:await action(params.actionId,params.payload)}),onEvent:(event,listener)=>{if(event==='plugin.loops-poc.changed'){listeners.add(listener);return ()=>listeners.delete(listener);}return ()=>{};},subscribe:()=>()=>{},sessions:{rows:sessions,selectedKey:sessions[0].key,normalizeKey:key=>key,refresh:async()=>{},observe:(_query,listener)=>{sessionListeners.add(listener);listener({result:{sessions:visibleSessions}});return {dispose:()=>sessionListeners.delete(listener)};},open:()=>{},create:async()=>visibleSessions[0].key,patch:async()=>{}},agents:{rows:[{id:'main',name:'Main'},{id:'other',name:'Other'}],selectedId:'main',defaultId:'main',scopeId:null,select:()=>{},setScope:()=>{},refresh:async()=>{}},navigation:{openPage:()=>{},pageHref:()=>''},ui:{invalidate:()=>{},registerPage:()=>()=>{},registerNavigation:()=>()=>{},registerPanel:()=>()=>{},registerAction:()=>()=>{},registerAccessory:()=>()=>{},registerWidget:()=>()=>{},registerReplacement:()=>()=>{},selectReplacement:()=>{}}};
  const root=createRoot(document.getElementById('app')); globalThis.__editorRegression={calls,records,deferNextDraft:()=>{delayDrafts++;},deferredDraftCount:()=>deferredDrafts.length,resolveNextDraft:()=>{const next=deferredDrafts.shift();if(!next)throw Error('No deferred draft.');const notify=!withholdNextDraftChanged;withholdNextDraftChanged=false;next.resolve(save(next.payload.definition,false,'draft',next.payload.expectedRevision,notify));},withholdNextDraftChanged:()=>{withholdNextDraftChanged=true;},deferredChangedCount:()=>deferredChanged.length,releaseNextChanged:()=>{const deliver=deferredChanged.shift();if(!deliver)throw Error('No withheld change.');calls.push({mode:'changed-released'});deliver();},pendingDraft:()=>{const next=deferredDrafts[0];return next?{id:next.payload.definition.id,name:next.payload.definition.name}:null;},rejectNextDraft:message=>{const next=deferredDrafts.shift();if(!next)throw Error('No deferred draft.');next.reject(Error(message));},deferNextLoad:()=>{delayLoads++;},deferredLoadCount:()=>deferredLoads.length,resolveNextLoad:()=>{const next=deferredLoads.shift();if(!next)throw Error('No deferred load.');next.resolve(clone(records.get(next.payload.id)));},rejectNextLoad:message=>{const next=deferredLoads.shift();if(!next)throw Error('No deferred load.');next.reject(Error(message));},switchConversation:key=>{const session=sessions.find(item=>item.key===key);if(!session)throw Error('Unknown session.');visibleSessions=[session];publishSessions();},failNextLocalDraftWrite:()=>{const original=globalThis.Storage.prototype.setItem;globalThis.Storage.prototype.setItem=function(key,value){if(String(key).startsWith('loops-editor:v2:')){globalThis.Storage.prototype.setItem=original;localDraftWriteFailures++;throw Error('synthetic local draft write failure');}return original.call(this,key,value);};},localDraftWriteFailures:()=>localDraftWriteFailures,addPendingRun,addTypedContextRun,addTypedRouteRun,refresh:emit,unmount:()=>root.unmount()}; root.render(React.createElement(React.StrictMode,null,React.createElement(Editor,{host})));
`}

async function serve(html){
  const server=createServer((request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,url:`http://127.0.0.1:${server.address().port}`};
}
const waitFor=async(page,selector)=>page.locator(selector).waitFor({state:'visible',timeout:10_000});

async function verifyEvaluationDraftRaces(browser,url,checks){
  const open=async()=>{const page=await browser.newPage();page.setDefaultTimeout(10_000);await page.goto(url);await waitFor(page,'select[aria-label="Load an example"]');await page.selectOption('select[aria-label="Load an example"]','summarize-text');return page;};
  const addEvaluation=async page=>{await page.selectOption('select[aria-label="Node family"]','evaluate');await page.getByRole('button',{name:'+ Add node'}).click();return page.getByRole('textbox',{name:'JSON Schema',exact:true});};
  {
    const page=await open(),schema=await addEvaluation(page);
    await page.getByRole('button',{name:'Save draft'}).click();await page.getByText('Revision 1 saved as a draft').waitFor();
    await schema.fill('{"type":"string","minLength":1}');await page.evaluate(()=>globalThis.__editorRegression.deferNextDraft());await page.getByRole('button',{name:'Save draft'}).click();await page.waitForFunction(()=>globalThis.__editorRegression.deferredDraftCount()===1);
    await schema.fill('{');await page.evaluate(()=>globalThis.__editorRegression.resolveNextDraft());await page.getByText('Revision 2 saved; newer draft edits are retained.').waitFor();
    assert.equal(await schema.inputValue(),'{');assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),true);checks.push('invalid evaluator text survives a pending save acknowledgment');await page.close();
  }
  {
    const page=await open(),schema=await addEvaluation(page);
    await page.getByRole('button',{name:'Save draft'}).click();await page.getByText('Revision 1 saved as a draft').waitFor();
    await page.evaluate(()=>{globalThis.__editorRegression.deferNextLoad();globalThis.__editorRegression.refresh();});await page.waitForFunction(()=>globalThis.__editorRegression.deferredLoadCount()===1);
    await schema.fill('{');await page.evaluate(()=>globalThis.__editorRegression.resolveNextLoad());await page.waitForFunction(()=>globalThis.__editorRegression.deferredLoadCount()===0);await page.waitForTimeout(100);
    assert.equal(await schema.inputValue(),'{');assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),true);checks.push('invalid evaluator text survives a pending clean refresh');await page.close();
  }
  for(const pending of ['save','refresh']){
    const page=await open();await addEvaluation(page);
    await page.locator('.lp-evaluation-editor select').first().selectOption('predicate');await page.locator('.lp-evaluation-editor select').nth(1).selectOption('equals');
    const expected=page.getByRole('textbox',{name:'Expected JSON value',exact:true});await expected.fill('0');
    await page.getByRole('button',{name:'Save draft'}).click();await page.getByText('Revision 1 saved as a draft').waitFor();
    if(pending==='save'){
      await expected.fill('1');await page.evaluate(()=>globalThis.__editorRegression.deferNextDraft());await page.getByRole('button',{name:'Save draft'}).click();await page.waitForFunction(()=>globalThis.__editorRegression.deferredDraftCount()===1);
    }else{
      await page.evaluate(()=>{globalThis.__editorRegression.deferNextLoad();globalThis.__editorRegression.refresh();});await page.waitForFunction(()=>globalThis.__editorRegression.deferredLoadCount()===1);
    }
    await expected.fill('{');
    if(pending==='save'){await page.evaluate(()=>globalThis.__editorRegression.resolveNextDraft());await page.getByText('Revision 2 saved; newer draft edits are retained.').waitFor();}
    else{await page.evaluate(()=>globalThis.__editorRegression.resolveNextLoad());await page.waitForFunction(()=>globalThis.__editorRegression.deferredLoadCount()===0);await page.waitForTimeout(100);}
    assert.equal(await expected.inputValue(),'{');assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),true);checks.push(`invalid predicate text survives a pending ${pending}`);await page.close();
  }
  {
    const page=await open();await page.getByRole('button',{name:'Save draft'}).click();await page.getByText('Revision 1 saved as a draft').waitFor();
    await page.getByLabel('Node label').fill('Changed input');const schema=await addEvaluation(page);await schema.fill('{');await page.getByRole('button',{name:'Undo',exact:true}).click();
    assert.equal(await page.getByText('Finish the invalid evaluator JSON before saving or publishing.').count(),0);assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),false);
    await page.getByRole('button',{name:'Save draft'}).click();await page.getByText('Revision 2 saved as a draft').waitFor();await page.getByRole('button',{name:'Redo',exact:true}).click();
    assert.equal(await schema.inputValue(),'{');assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),true);checks.push('Undo excludes an inactive invalid evaluator draft and Redo restores it after save');await page.close();
  }
}

export async function runDataSchemaDraftRegression({receiptPath}={}){
  const bundle=await build({stdin:{contents:harness(),resolveDir:root,loader:'ts'},bundle:true,format:'iife',platform:'browser',write:false,target:'es2022'});
  const {server,url}=await serve(`<!doctype html><html><body><div id="app"></div><script>${bundle.outputFiles[0].text}</script></body></html>`);
  const receipt={runner:'mounted-data-schema-editor-playwright',transport:'synthetic fake backend; no provider invoked',checks:[],errors:[]};let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(10_000);page.on('pageerror',error=>receipt.errors.push(error.message));
    await page.goto(url);await waitFor(page,'select[aria-label="Load an example"]');await page.selectOption('select[aria-label="Load an example"]','summarize-text');
    await page.getByRole('button',{name:'Save draft'}).click();await page.getByText('Revision 1 saved as a draft').waitFor();await page.getByLabel('Run target').selectOption('draft');
    await page.getByRole('button',{name:'Add nested schema'}).click();const enumBox=page.getByRole('textbox',{name:'Enum JSON values'}).first();
    receipt.browserBuffer=await page.evaluate(()=>typeof Buffer);receipt.visibleValidation=await page.locator('.lp-validation-error').allTextContents();
    await enumBox.fill('[');assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Save & publish'}).isDisabled(),true);receipt.checks.push('invalid enum draft blocks Save and Publish without overwriting the last valid schema');
    await page.selectOption('select[aria-label="Select node to edit"]','summary');await page.selectOption('select[aria-label="Select node to edit"]','input');assert.equal(await enumBox.inputValue(),'[');receipt.checks.push('invalid enum text survives node selection');
    await enumBox.fill('[0]');await page.evaluate(()=>globalThis.__editorRegression.deferNextDraft());await page.getByRole('button',{name:'Save draft'}).click();await page.waitForFunction(()=>globalThis.__editorRegression.deferredDraftCount()===1);
    await enumBox.fill('[');assert.equal(await page.locator('.lp-run-button').isDisabled(),true);await page.evaluate(()=>globalThis.__editorRegression.resolveNextDraft());await page.getByText('Revision 2 saved; newer draft edits are retained.').waitFor();assert.equal(await enumBox.inputValue(),'[');assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),true);assert.equal(await page.locator('.lp-run-button').isDisabled(),true);receipt.checks.push('newer invalid enum text survives pending save acknowledgment and blocks current-draft Test');
    await page.evaluate(()=>{globalThis.__editorRegression.deferNextLoad();globalThis.__editorRegression.refresh();});await page.waitForFunction(()=>globalThis.__editorRegression.deferredLoadCount()===1);
    await enumBox.fill('[,');assert.equal(await page.locator('.lp-run-button').isDisabled(),true);await page.evaluate(()=>globalThis.__editorRegression.resolveNextLoad());await page.waitForFunction(()=>globalThis.__editorRegression.deferredLoadCount()===0);assert.equal(await enumBox.inputValue(),'[,');assert.equal(await page.locator('.lp-run-button').isDisabled(),true);receipt.checks.push('newer invalid enum text survives pending refresh and blocks current-draft Test');
    await page.getByRole('button',{name:'Remove schema'}).click();assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),false);
    await page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await enumBox.inputValue(),'[,');assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),true);
    await page.getByRole('button',{name:'Redo',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),false);receipt.checks.push('inactive invalid schema draft does not block Save; Undo restores its active location');
    await page.getByRole('button',{name:'Undo',exact:true}).click();await page.getByRole('button',{name:'Discard invalid enum text'}).click();assert.equal(await enumBox.inputValue(),'[0]');
    await enumBox.fill('[1]');await page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await enumBox.inputValue(),'[0]');await page.getByRole('button',{name:'Redo',exact:true}).click();assert.equal(await enumBox.inputValue(),'[1]');receipt.checks.push('valid parent enum value resynchronizes after Undo and Redo');
    await page.getByRole('button',{name:'Add property'}).click();const propertyEnum=page.getByRole('textbox',{name:'Enum JSON values'}).nth(1);await propertyEnum.fill('{');
    await page.selectOption('select[aria-label="Select node to edit"]','summary');await page.selectOption('select[aria-label="Select node to edit"]','input');assert.equal(await propertyEnum.inputValue(),'{');assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),true);receipt.checks.push('nested property enum draft retains its schema-location identity across selection');
    await page.getByRole('button',{name:'Discard invalid enum text'}).last().click();await page.selectOption('select[aria-label="Select node to edit"]','summary');
    await page.locator('details.lp-output-schema summary').click();const structured=page.getByLabel('Structured generation');
    await page.locator('details.lp-output-schema').getByRole('button',{name:'Add nested schema'}).click();
    await page.getByLabel('Output format').selectOption('json');await structured.selectOption('native');await page.getByRole('button',{name:'Save draft'}).click();
    await page.waitForFunction(()=>globalThis.__editorRegression.calls.some(call=>call.mode==='draft'&&call.definition.nodes.find(node=>node.id==='summary')?.structuredGeneration==='native'));
    const authored=await page.evaluate(()=>globalThis.__editorRegression.calls.findLast(call=>call.mode==='draft').definition);
    assert.equal(authored.schemaVersion,3);assert.equal(authored.nodes.find(node=>node.id==='summary').outputSchema.type,'object');receipt.checks.push('explicit native mode authoring upgrades v3 and saves with its schema');
    assert.deepEqual(receipt.errors,[]);receipt.passed=true;
  }catch(error){receipt.failure=error.message;throw error;}finally{if(receiptPath)await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n');await browser?.close();await new Promise(resolve=>server.close(resolve));}
  return receipt;
}

export async function runDataSchemaRenameRegression({receiptPath}={}){
  const bundle=await build({stdin:{contents:harness(),resolveDir:root,loader:'ts'},bundle:true,format:'iife',platform:'browser',write:false,target:'es2022'});
  const {server,url}=await serve(`<!doctype html><html><body><div id="app"></div><script>${bundle.outputFiles[0].text}</script></body></html>`);
  const receipt={runner:'mounted-data-schema-rename-playwright',transport:'synthetic fake backend; no provider invoked',observed:{},errors:[]};let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(10_000);page.on('pageerror',error=>receipt.errors.push(error.message));
    await page.goto(url);await waitFor(page,'select[aria-label="Load an example"]');await page.selectOption('select[aria-label="Load an example"]','summarize-text');
    await page.getByRole('button',{name:'Add nested schema'}).click();await page.getByRole('button',{name:'Add property'}).click();
    const name=page.getByLabel('Property 1 name');await name.click();await name.press('End');await name.pressSequentially('_typed');
    receipt.observed.sequentialName=await name.inputValue();receipt.observed.nameKeepsFocus=await name.evaluate(element=>element===globalThis.document.activeElement);
    await name.fill('renamed');await page.getByRole('button',{name:'Save & publish'}).click();await page.getByText('Revision 1 saved and enabled for chat and UI').waitFor();
    const enumBox=page.getByRole('textbox',{name:'Enum JSON values'}).nth(1);await enumBox.fill('{');
    await page.getByLabel('Run target').selectOption('draft');
    receipt.observed.draftTestDisabled=await page.getByRole('button',{name:'Test current draft'}).isDisabled();receipt.observed.exportDisabled=await page.getByRole('button',{name:'Export',exact:true}).isDisabled();
    const draftTest=page.getByRole('button',{name:'Test current draft'});if(receipt.observed.draftTestDisabled)await draftTest.evaluate(button=>button.removeAttribute('disabled'));await draftTest.click();
    receipt.observed.draftTestDispatched=await page.evaluate(()=>globalThis.__editorRegression.calls.some(call=>call.id==='test'));
    await page.getByLabel('Run target').selectOption('published');receipt.observed.publishedRunEnabled=!(await page.getByRole('button',{name:'▶ Run loop'}).isDisabled());await page.getByRole('button',{name:'▶ Run loop'}).click();
    receipt.observed.publishedRunPinned=await page.evaluate(()=>{const state=globalThis.__editorRegression,slug=state.calls.findLast(call=>call.id==='run')?.payload.slug;return [...state.records.values()].some(record=>record.enabledRevision===1&&record.revisions[1]?.slug===slug);});await page.getByLabel('Run target').selectOption('draft');
    await page.getByRole('button',{name:'Undo',exact:true}).click();receipt.observed.ackUndoRaw=await enumBox.inputValue();receipt.observed.ackUndoPublishDisabled=await page.getByRole('button',{name:/Publish r1|Save & publish/}).isDisabled();
    await page.getByRole('button',{name:'Redo',exact:true}).click();receipt.observed.ackRedoRaw=await enumBox.inputValue();
    await name.fill('again');receipt.observed.propertyRenameDisabled=await page.getByRole('button',{name:'Save draft'}).isDisabled();
    await page.getByRole('button',{name:'Undo',exact:true}).click();receipt.observed.propertyUndoDisabled=await page.getByRole('button',{name:'Save draft'}).isDisabled();receipt.observed.propertyUndoPublishDisabled=await page.getByRole('button',{name:/Publish r1|Save & publish/}).isDisabled();receipt.observed.propertyUndoRaw=await enumBox.inputValue();
    await page.getByRole('button',{name:'Redo',exact:true}).click();receipt.observed.propertyRedoDisabled=await page.getByRole('button',{name:'Save draft'}).isDisabled();
    const inputName=page.getByLabel('Input 1 name');await inputName.fill('payload');receipt.observed.inputRenameDisabled=await page.getByRole('button',{name:'Save draft'}).isDisabled();
    await page.getByRole('button',{name:'Undo',exact:true}).click();receipt.observed.inputUndoDisabled=await page.getByRole('button',{name:'Save draft'}).isDisabled();receipt.observed.inputUndoPublishDisabled=await page.getByRole('button',{name:/Publish r1|Save & publish/}).isDisabled();receipt.observed.inputUndoRaw=await enumBox.inputValue();
    await page.getByRole('button',{name:'Redo',exact:true}).click();receipt.observed.inputRedoDisabled=await page.getByRole('button',{name:'Save draft'}).isDisabled();
    await page.getByLabel('Node label').fill('Changed input');await page.getByRole('button',{name:'Undo',exact:true}).click();receipt.observed.unrelatedUndoRaw=await enumBox.inputValue();receipt.observed.unrelatedUndoPublishDisabled=await page.getByRole('button',{name:/Publish r1|Save & publish/}).isDisabled();
    const numeric=await browser.newPage();numeric.setDefaultTimeout(10_000);numeric.on('pageerror',error=>receipt.errors.push(error.message));await numeric.goto(url);await waitFor(numeric,'select[aria-label="Load an example"]');await numeric.selectOption('select[aria-label="Load an example"]','summarize-text');
    await numeric.getByRole('button',{name:'Add nested schema'}).click();const addRootProperty=numeric.locator('fieldset.lp-data-schema').first().locator(':scope > button').filter({hasText:'Add property'});await addRootProperty.click();await addRootProperty.click();
    const second=numeric.locator('.lp-data-schema-property').nth(1);await second.getByRole('checkbox',{name:'Required'}).check();await second.getByRole('combobox',{name:/value type/}).selectOption('number');
    const propertyRows=()=>numeric.locator('.lp-data-schema-property').evaluateAll(rows=>rows.map(row=>({name:row.querySelector('label.lp-field input')?.value,required:row.querySelector('label.lp-check input')?.checked,schemaType:row.querySelector('fieldset.lp-data-schema select')?.value,raw:row.querySelector('fieldset.lp-data-schema textarea')?.value})).sort((left,right)=>left.name.localeCompare(right.name)));
    await numeric.locator('.lp-data-schema-property').nth(0).locator('fieldset.lp-data-schema textarea').fill('{alpha');await second.locator('fieldset.lp-data-schema textarea').fill('{beta');
    const secondName=second.locator('label.lp-field input').first(),secondHandle=await secondName.elementHandle();await secondName.fill('1');receipt.observed.numericNameKeepsFocus=await secondHandle.evaluate(element=>element===globalThis.document.activeElement);await numeric.keyboard.type('2');
    receipt.observed.numericRows=await propertyRows();await numeric.getByRole('button',{name:'Undo',exact:true}).click();await numeric.getByRole('button',{name:'Undo',exact:true}).click();receipt.observed.numericUndoRows=await propertyRows();
    await numeric.getByRole('button',{name:'Redo',exact:true}).click();await numeric.getByRole('button',{name:'Redo',exact:true}).click();receipt.observed.numericRedoRows=await propertyRows();
    await numeric.close();
    const duplicate=await browser.newPage();duplicate.setDefaultTimeout(10_000);duplicate.on('pageerror',error=>receipt.errors.push(error.message));await duplicate.goto(url);await waitFor(duplicate,'select[aria-label="Load an example"]');await duplicate.selectOption('select[aria-label="Load an example"]','summarize-text');
    await duplicate.getByRole('button',{name:'Add nested schema'}).click();await duplicate.getByRole('button',{name:'+ Add input'}).click();await duplicate.locator('.lp-input-definition').nth(1).getByRole('button',{name:'Add nested schema'}).click();
    const inputRows=duplicate.locator('.lp-input-definition');await inputRows.nth(0).getByRole('textbox',{name:'Enum JSON values'}).fill('{first');await inputRows.nth(1).getByRole('textbox',{name:'Enum JSON values'}).fill('{second');
    await duplicate.getByLabel('Input 2 name').fill('text');receipt.observed.duplicateInputRaw=await Promise.all([inputRows.nth(0).getByRole('textbox',{name:'Enum JSON values'}).inputValue(),inputRows.nth(1).getByRole('textbox',{name:'Enum JSON values'}).inputValue()]);
    await inputRows.nth(0).getByRole('button',{name:'Remove field'}).click();receipt.observed.remainingInputRaw=await inputRows.nth(0).getByRole('textbox',{name:'Enum JSON values'}).inputValue();
    await duplicate.getByRole('button',{name:'Undo',exact:true}).click();receipt.observed.restoredInputRaw=await Promise.all([inputRows.nth(0).getByRole('textbox',{name:'Enum JSON values'}).inputValue(),inputRows.nth(1).getByRole('textbox',{name:'Enum JSON values'}).inputValue()]);
    await duplicate.getByRole('button',{name:'Redo',exact:true}).click();receipt.observed.redoneInputRaw=await inputRows.nth(0).getByRole('textbox',{name:'Enum JSON values'}).inputValue();await duplicate.close();
    assert.deepEqual(receipt.observed,{sequentialName:'property_1_typed',nameKeepsFocus:true,draftTestDisabled:true,exportDisabled:true,draftTestDispatched:false,publishedRunEnabled:true,publishedRunPinned:true,ackUndoRaw:'{',ackUndoPublishDisabled:true,ackRedoRaw:'{',propertyRenameDisabled:true,propertyUndoDisabled:true,propertyUndoPublishDisabled:true,propertyUndoRaw:'{',propertyRedoDisabled:true,inputRenameDisabled:true,inputUndoDisabled:true,inputUndoPublishDisabled:true,inputUndoRaw:'{',inputRedoDisabled:true,unrelatedUndoRaw:'{',unrelatedUndoPublishDisabled:true,numericNameKeepsFocus:true,numericRows:[{name:'12',required:true,schemaType:'number',raw:'{beta'},{name:'property_1',required:false,schemaType:'object',raw:'{alpha'}],numericUndoRows:[{name:'property_1',required:false,schemaType:'object',raw:'{alpha'},{name:'property_2',required:true,schemaType:'number',raw:'{beta'}],numericRedoRows:[{name:'12',required:true,schemaType:'number',raw:'{beta'},{name:'property_1',required:false,schemaType:'object',raw:'{alpha'}],duplicateInputRaw:['{first','{second'],remainingInputRaw:'{second',restoredInputRaw:['{first','{second'],redoneInputRaw:'{second'});
    assert.deepEqual(receipt.errors,[]);receipt.passed=true;
  }catch(error){receipt.failure=error.message;throw error;}finally{if(receiptPath)await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n');await browser?.close();await new Promise(resolve=>server.close(resolve));}
  return receipt;
}

export async function runUnvisitedSchemaHistoryRegression({receiptPath}={}){
  const bundle=await build({stdin:{contents:harness(),resolveDir:root,loader:'ts'},bundle:true,format:'iife',platform:'browser',write:false,target:'es2022'});
  const {server,url}=await serve(`<!doctype html><html><body><div id="app"></div><script>${bundle.outputFiles[0].text}</script></body></html>`);
  const receipt={runner:'mounted-unvisited-schema-history-playwright',transport:'synthetic fake backend; no provider invoked',checks:[],errors:[]};let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(10_000);page.on('pageerror',error=>receipt.errors.push(error.message));
    await page.goto(url);await waitFor(page,'select[aria-label="Load an example"]');
    const fixture={schemaVersion:3,id:'unvisited-schema-history',slug:'unvisited-schema-history',name:'Unvisited schema history',description:'Mounted history regression.',revision:1,inputSchema:[{name:'payload',label:'Payload',type:'json',required:true,schema:{type:'object',properties:{title:{type:'string'}},required:['title'],additionalProperties:false}}],capabilities:[],limits:{maxExecutions:8,maxOutputBytes:4096},nodes:[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:{literalJson:'[{"status":"done"}]'},outputSchema:{type:'array',items:{type:'object',properties:{status:{type:'string'}},required:['status'],additionalProperties:false}}}],edges:[{id:'input-return',source:'input',target:'return',port:'next'}],layout:{input:{x:0,y:0},return:{x:280,y:0}}};
    await page.evaluate(definition=>{const state=globalThis.__editorRegression,record={definition,enabledRevision:1,publishedRevision:1,grants:[],revisions:{1:structuredClone(definition)}};state.records.set(definition.id,record);state.refresh();},fixture);
    await page.locator('.lp-loop-card').filter({hasText:'Unvisited schema history'}).click();await page.getByLabel('Input 1 name').waitFor();
    await page.getByLabel('Display label').fill('Changed payload label');receipt.checks.push('unrelated edit snapshots an already existing but unvisited nested output schema');
    await page.selectOption('select[aria-label="Select node to edit"]','return');await page.locator('details.lp-output-schema summary').click();const enumBox=page.getByRole('textbox',{name:'Enum JSON values'}).last();
    await enumBox.fill('[');assert.equal(await enumBox.inputValue(),'[');assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Save & publish'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Export',exact:true}).isDisabled(),true);
    await page.getByLabel('Run target').selectOption('draft');const draftTest=page.locator('.lp-run-button');assert.equal(await draftTest.isDisabled(),true);await draftTest.evaluate(button=>button.removeAttribute('disabled'));await draftTest.click();await draftTest.evaluate(button=>button.setAttribute('disabled',''));assert.equal(await page.evaluate(()=>globalThis.__editorRegression.calls.some(call=>call.id==='test')),false);
    let downloads=0;page.on('download',()=>downloads++);const exportButton=page.getByRole('button',{name:'Export',exact:true});await exportButton.evaluate(button=>button.removeAttribute('disabled'));await exportButton.click();await exportButton.evaluate(button=>button.setAttribute('disabled',''));assert.equal(downloads,0);receipt.checks.push('invalid nested output text blocks Save, Publish, draft Test dispatch and Export download');
    await page.getByLabel('Run target').selectOption('published');assert.equal(await page.getByRole('button',{name:'▶ Run loop'}).isDisabled(),false);await page.getByRole('button',{name:'▶ Run loop'}).click();assert.equal(await page.evaluate(()=>globalThis.__editorRegression.calls.some(call=>call.id==='run'&&call.payload.slug==='unvisited-schema-history')),true);await page.getByLabel('Run target').selectOption('draft');receipt.checks.push('published revision remains independently runnable');
    await page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await enumBox.inputValue(),'[');assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Save & publish'}).isDisabled(),true);assert.equal(await page.locator('.lp-run-button').isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Export',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Redo',exact:true}).click();assert.equal(await enumBox.inputValue(),'[');receipt.checks.push('Undo and Redo of unrelated label edit retain newer invalid text in previously unvisited nested array output');
    await page.getByRole('button',{name:'Discard invalid enum text'}).last().click();await enumBox.fill('["done"]');await page.evaluate(()=>globalThis.__editorRegression.deferNextDraft());await page.getByRole('button',{name:'Save draft'}).click();await page.waitForFunction(()=>globalThis.__editorRegression.deferredDraftCount()===1);
    await enumBox.fill('[');await page.evaluate(()=>globalThis.__editorRegression.resolveNextDraft());await page.getByText('Revision 2 saved; newer draft edits are retained.').waitFor();assert.equal(await enumBox.inputValue(),'[');
    await page.getByRole('button',{name:'Undo',exact:true}).click();await page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await enumBox.inputValue(),'[');assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Save & publish'}).isDisabled(),true);assert.equal(await page.locator('.lp-run-button').isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Export',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Redo',exact:true}).click();await page.getByRole('button',{name:'Redo',exact:true}).click();assert.equal(await enumBox.inputValue(),'[');receipt.checks.push('pending save acknowledgment and revision rebase retain invalid text through unrelated Undo and Redo');
    assert.deepEqual(receipt.errors,[]);receipt.passed=true;
  }catch(error){receipt.failure=error.message;throw error;}finally{if(receiptPath)await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n');await browser?.close();await new Promise(resolve=>server.close(resolve));}
  return receipt;
}

export async function runSwitchCaseDraftRegression({receiptPath}={}){
  const bundle=await build({stdin:{contents:harness(),resolveDir:root,loader:'ts'},bundle:true,format:'iife',platform:'browser',write:false,target:'es2022'});
  const {server,url}=await serve(`<!doctype html><html><body><div id="app"></div><script>${bundle.outputFiles[0].text}</script></body></html>`);
  const receipt={runner:'mounted-switch-case-draft-playwright',transport:'synthetic fake backend; no provider invoked',checks:[],errors:[]};let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(10_000);page.on('pageerror',error=>receipt.errors.push(error.message));
    await page.goto(url);await waitFor(page,'select[aria-label="Load an example"]');await page.selectOption('select[aria-label="Load an example"]','summarize-text');
    await page.selectOption('select[aria-label="Node family"]','switch');await page.getByRole('button',{name:'+ Add node'}).click();
    const selection=page.locator('select[aria-label="Select node to edit"]'),switchId=await selection.inputValue(),caseValue=page.getByLabel('Case 1 typed value JSON');
    await page.getByRole('button',{name:'Save draft'}).click();try{await page.getByText('Revision 1 saved as a draft').waitFor();}catch(error){receipt.saveDiagnostic=await page.evaluate(()=>({messages:[...globalThis.document.querySelectorAll('[role="status"],[role="alert"]')].map(element=>element.textContent),draft:globalThis.__editorRegression.calls.filter(call=>call.mode==='draft').at(-1),saveDisabled:globalThis.document.querySelector('.lp-canvas-heading button')?.disabled}));throw error;}
    await caseValue.fill('{');assert.equal(await caseValue.inputValue(),'{');assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Save & publish'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Export',exact:true}).isDisabled(),true);await page.getByLabel('Run target').selectOption('draft');const draftTest=page.locator('.lp-run-button');assert.equal(await draftTest.isDisabled(),true);await draftTest.evaluate(button=>button.removeAttribute('disabled'));await draftTest.click();assert.equal(await page.evaluate(()=>globalThis.__editorRegression.calls.some(call=>call.id==='test')),false);receipt.checks.push('invalid case JSON persists and blocks Save, Publish, Export, and draft Test dispatch');
    await selection.selectOption('summary');await selection.selectOption(switchId);assert.equal(await caseValue.inputValue(),'{');receipt.checks.push('invalid case text survives node selection');
    await page.getByRole('button',{name:'Discard invalid case text'}).click();await caseValue.fill('0');await page.evaluate(()=>globalThis.__editorRegression.deferNextDraft());await page.getByRole('button',{name:'Save draft'}).click();await page.waitForFunction(()=>globalThis.__editorRegression.deferredDraftCount()===1);
    await caseValue.fill('{');await page.evaluate(()=>globalThis.__editorRegression.resolveNextDraft());await page.getByText('Revision 2 saved; newer draft edits are retained.').waitFor();assert.equal(await caseValue.inputValue(),'{');assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),true);receipt.checks.push('newer invalid case text survives pending save acknowledgment');
    await page.evaluate(()=>{globalThis.__editorRegression.deferNextLoad();globalThis.__editorRegression.refresh();});await page.waitForFunction(()=>globalThis.__editorRegression.deferredLoadCount()===1);
    await caseValue.fill('[,');await page.evaluate(()=>globalThis.__editorRegression.resolveNextLoad());await page.waitForFunction(()=>globalThis.__editorRegression.deferredLoadCount()===0);assert.equal(await caseValue.inputValue(),'[,');receipt.checks.push('newer invalid case text survives pending refresh');
    await page.getByRole('button',{name:'Remove selected node'}).click();assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),false);
    await page.getByRole('button',{name:'Undo',exact:true}).click();await selection.selectOption(switchId);assert.equal(await caseValue.inputValue(),'[,');assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),true);
    await page.getByRole('button',{name:'Redo',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),false);receipt.checks.push('orphaned invalid case draft does not block Save; Undo restores it');
    assert.deepEqual(receipt.errors,[]);receipt.passed=true;
  }catch(error){receipt.failure=error.message;throw error;}finally{if(receiptPath)await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n');await browser?.close();await new Promise(resolve=>server.close(resolve));}
  return receipt;
}

export async function runTimeoutVersionRegression({receiptPath}={}){
  const bundle=await build({stdin:{contents:harness(),resolveDir:root,loader:'ts'},bundle:true,format:'iife',platform:'browser',write:false,target:'es2022'});
  const {server,url}=await serve(`<!doctype html><html><body><div id="app"></div><script>${bundle.outputFiles[0].text}</script></body></html>`);
  const receipt={runner:'mounted-timeout-version-playwright',transport:'synthetic fake backend; no provider invoked',checks:[],errors:[]};let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(10_000);page.on('pageerror',error=>receipt.errors.push(error.message));
    await page.goto(url);await waitFor(page,'select[aria-label="Load an example"]');
    const base={id:'timeout-v1',slug:'timeout-v1',name:'Timeout version 1',description:'',revision:1,schemaVersion:1,inputSchema:[{name:'text',label:'Text',type:'text',required:true}],capabilities:[],nodes:[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'{{input.text}}'}],edges:[{id:'next',source:'input',target:'return',port:'next'}],layout:{input:{x:0,y:0},return:{x:200,y:0}},limits:{maxExecutions:2,timeoutMs:120000,maxOutputBytes:4096}};
    const v2={...structuredClone(base),id:'timeout-v2',slug:'timeout-v2',name:'Timeout version 2',schemaVersion:2,limits:{maxExecutions:2,maxOutputBytes:4096}};
    const v3={...structuredClone(v2),id:'timeout-v3',slug:'timeout-v3',name:'Timeout version 3',schemaVersion:3,inputSchema:[{name:'payload',label:'Payload',type:'json',required:true,schema:{type:'object',properties:{answer:{type:'number'}},required:['answer'],additionalProperties:false}}],nodes:[{id:'input',kind:'input',label:'Input',context:{version:1,projection:{mode:'omit'},patch:{mode:'replace',target:'/answer',source:{kind:'literal',value:{literalJson:'0'}}}}},{id:'return',kind:'return',label:'Return',value:'{{context.answer}}',outputSchema:{type:'number'},context:{version:1,projection:{mode:'consume',paths:['/answer']},patch:{mode:'omit'}}}]};
    await page.evaluate(definitions=>{const state=globalThis.__editorRegression;for(const definition of definitions)state.records.set(definition.id,{definition,enabledRevision:null,publishedRevision:null,grants:[],revisions:{1:structuredClone(definition)}});state.refresh();},[base,v2,v3]);
    for(const [definition,expectedVersion] of [[base,2],[v2,2],[v3,3]]){
      await page.locator('.lp-loop-card').filter({hasText:definition.name}).click();await page.locator('.lp-canvas-heading h2').filter({hasText:definition.name}).waitFor();
      const details=page.locator('details.lp-definition-settings');if(!await details.getByLabel('Active timeout (seconds)',{exact:true}).isVisible())await details.locator('summary').click();
      const timeout=page.getByLabel('Active timeout (seconds)',{exact:true});await timeout.fill('123');await page.getByRole('button',{name:'Save draft'}).click();
      await page.waitForFunction(({id})=>globalThis.__editorRegression.records.get(id)?.definition.revision===2,{id:definition.id});
      let saved=await page.evaluate(id=>structuredClone(globalThis.__editorRegression.records.get(id).definition),definition.id);
      assert.equal(saved.schemaVersion,expectedVersion);assert.equal(saved.limits.timeoutMs,123000);assert.deepEqual(saved.nodes,definition.nodes);assert.deepEqual(saved.inputSchema,definition.inputSchema);
      const loadsBefore=await page.evaluate(()=>globalThis.__editorRegression.calls.filter(call=>call.id==='load').length);await page.evaluate(()=>globalThis.__editorRegression.refresh());await page.waitForFunction(before=>globalThis.__editorRegression.calls.filter(call=>call.id==='load').length>before,loadsBefore);assert.equal(await timeout.inputValue(),'123');
      await timeout.fill('');await page.getByRole('button',{name:'Save draft'}).click();await page.waitForFunction(({id})=>globalThis.__editorRegression.records.get(id)?.definition.revision===3,{id:definition.id});
      saved=await page.evaluate(id=>structuredClone(globalThis.__editorRegression.records.get(id).definition),definition.id);assert.equal(saved.schemaVersion,expectedVersion);assert.equal(Object.hasOwn(saved.limits,'timeoutMs'),false);assert.deepEqual(saved.nodes,definition.nodes);assert.deepEqual(saved.inputSchema,definition.inputSchema);
      assert.equal(await page.getByText('✓ Valid graph').count(),1);receipt.checks.push(`${definition.name} set, save/reload, and clear retain version ${expectedVersion} and authored graph`);
    }
    await page.selectOption('select[aria-label="Select node to edit"]','return');assert.equal(await page.getByLabel('Context projection').inputValue(),'consume');
    await page.selectOption('select[aria-label="Select node to edit"]','input');assert.equal(await page.getByLabel('Input payload nested schema value type').inputValue(),'object');receipt.checks.push('v3 context and recursive schema controls remain usable after timeout edits');
    assert.deepEqual(receipt.errors,[]);receipt.passed=true;
  }catch(error){receipt.failure=error.message;throw error;}finally{if(receiptPath)await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n');await browser?.close();await new Promise(resolve=>server.close(resolve));}
  return receipt;
}

export async function runBranchingReviewRegression({receiptPath}={}){
  const bundle=await build({stdin:{contents:harness(),resolveDir:root,loader:'ts'},bundle:true,format:'iife',platform:'browser',write:false,target:'es2022'});
  const {server,url}=await serve(`<!doctype html><html><body><div id="app"></div><script>${bundle.outputFiles[0].text}</script></body></html>`);
  const receipt={runner:'mounted-branching-review-playwright',transport:'synthetic fake backend; no provider invoked',checks:[],errors:[]};let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(10_000);page.on('pageerror',error=>receipt.errors.push(error.message));
    await page.goto(url);await waitFor(page,'select[aria-label="Load an example"]');await page.selectOption('select[aria-label="Load an example"]','summarize-text');
    await page.getByRole('button',{name:'Save draft'}).click();await page.getByText('Revision 1 saved as a draft').waitFor();
    await page.evaluate(()=>globalThis.__editorRegression.addTypedRouteRun('known-null-route',{port:'false',available:true,observed:'null'}));
    await page.locator('select[aria-label="Select run"] option[value="known-null-route"]').waitFor({state:'attached'});await page.selectOption('select[aria-label="Select run"]','known-null-route');
    await page.locator('.lp-run-node-detail .lp-route').getByText('null',{exact:true}).waitFor();assert.match(await page.locator('.lp-run-node-detail .lp-route').textContent(),/observed null/);receipt.checks.push('mounted Condition inspection preserves known null');
    await page.evaluate(()=>globalThis.__editorRegression.addTypedRouteRun('absent-route',{port:'true',available:false}));
    await page.locator('select[aria-label="Select run"] option[value="absent-route"]').waitFor({state:'attached'});await page.selectOption('select[aria-label="Select run"]','absent-route');
    await page.getByText('observed value unavailable',{exact:true}).waitFor();assert.equal(await page.locator('.lp-run-node-detail .lp-route code').count(),1);receipt.checks.push('mounted Condition inspection explicitly labels unavailable operand');
    await page.selectOption('select[aria-label="Node family"]','switch');await page.getByRole('button',{name:'+ Add node'}).click();
    await page.getByLabel('Case 1 typed value JSON').fill('{"outer":{"a":1,"b":[0,{"ready":false}]}}');
    await page.getByRole('button',{name:'+ Add case'}).click();await page.getByLabel('Case 2 typed value JSON').fill('{"outer":{"b":[0,{"ready":false}],"a":1}}');
    await page.locator('.lp-node-error').filter({hasText:/duplicate reachable case values/i}).waitFor();receipt.checks.push('unique Switch rejects reordered structural duplicate');
    await page.getByRole('combobox',{name:/Case matching/}).selectOption('ordered');await page.locator('.lp-node-error').filter({hasText:/duplicate reachable case values/i}).waitFor();receipt.checks.push('ordered Switch keeps the duplicate validation error');
    await page.getByRole('button',{name:'Remove case'}).last().click();await page.locator('.lp-node-error').filter({hasText:/duplicate reachable case values/i}).waitFor({state:'detached'});receipt.checks.push('removing the unreachable case clears duplicate validation');
    assert.deepEqual(receipt.errors,[]);receipt.passed=true;
  }catch(error){receipt.failure=error.message;throw error;}finally{if(receiptPath)await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n');await browser?.close();await new Promise(resolve=>server.close(resolve));}
  return receipt;
}

export async function runEditorAdvancedRegression({receiptPath}={}){
  const bundle=await build({stdin:{contents:harness(),resolveDir:root,loader:'ts'},bundle:true,format:'iife',platform:'browser',write:false,target:'es2022'});
  const {server,url}=await serve(`<!doctype html><html><body><div id="app"></div><script>${bundle.outputFiles[0].text}</script></body></html>`);
  let browser; let importDirectory;
  const receipt={runner:'mounted-production-editor-playwright',transport:'synthetic fake backend; no provider invoked',checks:[],errors:[]};
  try {
    browser=await chromium.launch({headless:true}); const page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.setDefaultTimeout(10_000);page.on('pageerror',error=>receipt.errors.push(error.message));page.on('dialog',dialog=>void dialog.accept());
    await page.goto(url); await waitFor(page,'select[aria-label="Load an example"]');
    await page.selectOption('select[aria-label="Load an example"]','summarize-text');
    await page.selectOption('select[aria-label="Select node to edit"]','input');
    await page.getByRole('button',{name:'Add nested schema'}).click();
    const addProperty=page.getByRole('button',{name:'Add property'});await addProperty.focus();await page.keyboard.press('Enter');
    await page.getByLabel('Property 1 name').fill('profile');await page.getByLabel('Property profile value type').selectOption('array');await page.getByLabel('Array item schema value type').selectOption('integer');
    assert.equal(await page.getByLabel('Input text nested schema value type').inputValue(),'object');await page.getByRole('button',{name:'Remove schema'}).first().click();await page.getByLabel('Value type').selectOption('text');receipt.checks.push('keyboard recursive input schema authoring creates nested object and array item schema');
    await page.selectOption('select[aria-label="Node family"]','evaluate'); await page.getByRole('button',{name:'+ Add node'}).click();
    const authorSelection=page.locator('select[aria-label="Select node to edit"]'); const evaluateId=await authorSelection.inputValue();
    await page.getByText('Deterministic evaluation').waitFor(); assert.equal(await page.getByRole('button',{name:'Enable version 3 shared context in this draft'}).count(),0);receipt.checks.push('Evaluate palette addition promotes the draft to version 3'); const evaluationSchema=page.getByRole('textbox',{name:'JSON Schema',exact:true});await evaluationSchema.fill('{');await page.getByRole('alert').filter({hasText:'valid JSON'}).waitFor();assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Save & publish'}).isDisabled(),true);await authorSelection.selectOption('summary');assert.equal(await page.getByRole('button',{name:'Save draft'}).isDisabled(),true);const invalidRefreshBefore=await page.evaluate(()=>globalThis.__editorRegression.calls.filter(call=>call.id==='load').length);await page.evaluate(()=>globalThis.__editorRegression.refresh());await page.waitForFunction(before=>globalThis.__editorRegression.calls.filter(call=>call.id==='load').length>before,invalidRefreshBefore);await authorSelection.selectOption(evaluateId);assert.equal(await evaluationSchema.inputValue(),'{');await page.getByRole('alert').filter({hasText:'valid JSON'}).waitFor();await evaluationSchema.fill('{"type":"string","minLength":1}');receipt.checks.push('invalid evaluator JSON survives selection unmount and reports its controlled error');
    await page.selectOption('select[aria-label="Node family"]','gate'); await page.getByRole('button',{name:'+ Add node'}).click();
    const gateId=await authorSelection.inputValue(),evaluationChoice=page.getByLabel('Committed Evaluate node'); await evaluationChoice.selectOption(evaluateId); assert.equal(await evaluationChoice.inputValue(),evaluateId);
    const disconnectedIssues=await page.locator('.lp-issues').textContent(); assert.match(disconnectedIssues??'',/Connect|unreachable/); receipt.checks.push('v3 disconnected palette state reports graph validation before publish');
    await page.selectOption('select[aria-label="Node family"]','return'); await page.getByRole('button',{name:'+ Add node'}).click(); const rejectedId=await authorSelection.inputValue();
    const connect=async(source,port,target)=>{await page.selectOption('select[aria-label="Connection source node"]',source);await page.selectOption('select[aria-label="Connection source branch"]',port);await page.selectOption('select[aria-label="Connection target node"]',target);await page.getByRole('button',{name:'Add connection'}).click();};
    await connect('input','next',evaluateId);await connect(evaluateId,'next',gateId);await connect(gateId,'true','summary');await connect(gateId,'false',rejectedId);
    await page.getByText('✓ Valid graph').waitFor(); assert.equal(await page.locator('.lp-issues').count(),0); receipt.checks.push('v3 Evaluate dominates Gate with connected terminal branches');
    await page.selectOption('select[aria-label="Select node to edit"]','summary');
    await page.getByRole('button',{name:'Configure context'}).click(); await page.getByRole('button',{name:'Remove context configuration'}).click(); await page.getByRole('button',{name:'Configure context'}).click();
    await page.getByLabel('Context projection').selectOption('consume'); await page.getByRole('textbox',{name:'Projected path 1',exact:true}).fill('/bad~2pointer'); await page.getByRole('status').getByText(/Use ~0 for ~/).waitFor(); await page.getByRole('textbox',{name:'Projected path 1',exact:true}).fill('/input/text');
    await page.getByLabel('Output patch').selectOption('replace'); await page.getByLabel('Context target JSON Pointer').fill('/result'); await page.getByLabel('Output patch').selectOption('append'); await page.getByLabel('Output patch').selectOption('merge'); await page.getByLabel('Output patch').selectOption('replace'); assert.equal(await page.getByLabel('Context target JSON Pointer').inputValue(),'/result'); await page.getByLabel('Patch source').selectOption('literal'); await page.getByLabel('Literal patch value JSON').fill('0');
    assert.equal(await page.getByLabel('Literal patch value JSON').inputValue(),'0'); receipt.checks.push('explicit v3 context authoring, repair, remove, and patch-mode preservation');
    await page.selectOption('select[aria-label="Select node to edit"]','return'); await page.getByRole('textbox',{name:'Return value or binding',exact:true}).fill('{{context.result}}'); await page.getByRole('button',{name:'Configure context'}).click(); await page.getByLabel('Context projection').selectOption('consume'); await page.getByRole('textbox',{name:'Projected path 1',exact:true}).fill('/result'); receipt.checks.push('explicit consuming Return authoring'); await page.selectOption('select[aria-label="Select node to edit"]','summary');
    await page.locator('details.lp-advanced summary').click();
    const temperature=page.getByLabel(/^Temperature/), maxTokens=page.getByLabel(/^Output tokens/);
    assert.equal(await temperature.inputValue(),''); assert.equal(await maxTokens.inputValue(),'');receipt.checks.push('inherit omits overrides');
    await temperature.fill('0'); assert.equal(await temperature.inputValue(),'0'); receipt.checks.push('explicit temperature zero');
    await maxTokens.fill('64');
    await page.getByRole('textbox',{name:'Model',exact:true}).fill('fake/switched'); assert.equal(await temperature.inputValue(),'0'); assert.equal(await maxTokens.inputValue(),'64'); receipt.checks.push('model switch preserves explicit overrides');
    await page.getByRole('button',{name:'Save & publish'}).click(); await waitFor(page,'text=Revision 1 saved and enabled for chat and UI.');
    const loadsBefore=await page.evaluate(()=>globalThis.__editorRegression.calls.filter(call=>call.id==='load').length); await page.evaluate(()=>globalThis.__editorRegression.refresh()); await page.waitForFunction(before=>globalThis.__editorRegression.calls.filter(call=>call.id==='load').length>before,loadsBefore); assert.equal(await page.getByLabel('Literal patch value JSON').inputValue(),'0'); receipt.checks.push('saved context configuration reloads through the synthetic transport');
    await page.evaluate(()=>globalThis.__editorRegression.addTypedContextRun('context-fixture'));
    await page.locator('select[aria-label="Select run"] option[value="context-fixture"]').waitFor({state:'attached'}); await page.selectOption('select[aria-label="Select run"]','context-fixture'); await page.getByText('Shared context provenance').waitFor();
    await page.getByText('Context version 1',{exact:false}).waitFor(); await page.getByText('v0 → v1 · summary',{exact:true}).waitFor(); await page.getByText('Resolved value SHA-256',{exact:false}).waitFor(); await page.getByRole('heading',{name:'Recorded output',exact:true}).waitFor(); assert.equal(await page.locator('.lp-run-node-detail .lp-full-output').textContent(),'0'); receipt.checks.push('synthetic typed context fixture applies authored patch and consuming Return, then renders provenance');
    await page.evaluate(()=>globalThis.__editorRegression.addPendingRun('empty-wait','waiting',''));
    await page.locator('select[aria-label="Select run"] option[value="empty-wait"]').waitFor({state:'attached'}); await page.selectOption('select[aria-label="Select run"]','empty-wait'); await page.getByRole('button',{name:'Continue'}).waitFor(); await page.getByRole('button',{name:'Continue'}).focus(); await page.keyboard.press('Enter'); await page.waitForFunction(()=>globalThis.__editorRegression.calls.some(call=>call.id==='resume'&&call.payload.runId==='empty-wait')); receipt.checks.push('empty Wait exposes keyboard Continue');
    await page.evaluate(()=>globalThis.__editorRegression.addPendingRun('empty-review','review',''));
    await page.locator('select[aria-label="Select run"] option[value="empty-review"]').waitFor({state:'attached'}); await page.selectOption('select[aria-label="Select run"]','empty-review'); await page.getByRole('button',{name:'Approve'}).waitFor(); await page.getByRole('button',{name:'Reject'}).waitFor(); assert.equal(await page.getByRole('button',{name:'Continue'}).count(),0); await page.getByRole('button',{name:'Approve'}).focus(); await page.keyboard.press('Enter'); await page.waitForFunction(()=>globalThis.__editorRegression.calls.some(call=>call.id==='review'&&call.payload.runId==='empty-review'&&call.payload.decision==='approve')); assert.equal(await page.evaluate(()=>globalThis.__editorRegression.calls.some(call=>call.id==='resume'&&call.payload.runId==='empty-review')),false); receipt.checks.push('empty Human review exposes keyboard approval without a resume bypass');
    await page.getByRole('button',{name:'Reset temperature'}).click(); assert.equal(await temperature.inputValue(),'');
    await page.getByRole('button',{name:'Save draft'}).click(); await waitFor(page,'text=Revision 2 saved as a draft'); receipt.checks.push('single Advanced reset');
    await temperature.fill('0'); await maxTokens.fill('96');
    await page.getByRole('button',{name:'Reset all Advanced settings'}).click(); assert.equal(await temperature.inputValue(),'');
    await page.getByRole('button',{name:'Save draft'}).click(); await waitFor(page,'text=Revision 3 saved as a draft'); receipt.checks.push('all Advanced reset');
    await temperature.fill('0'); await maxTokens.fill('96');
    await page.getByRole('button',{name:'Save & publish'}).click(); await waitFor(page,'text=Revision 4 saved and enabled for chat and UI.'); receipt.checks.push('model switch and publication');
    const [exported]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export',exact:true}).click()]); const exportedPath=await exported.path(); assert.ok(exportedPath,'Export must create a file.');
    const exportedDefinition=JSON.parse(await (await import('node:fs/promises')).readFile(exportedPath,'utf8')); assert.equal(exportedDefinition.nodes.find(node=>node.id==='summary').advanced.temperature,0); receipt.checks.push('export');
    await page.locator('details.lp-versions summary').click(); await page.selectOption('details.lp-versions select','1');
    await page.getByRole('button',{name:'Restore as draft'}).click(); await page.getByRole('button',{name:'Publish r5',exact:true}).waitFor(); await page.selectOption('select[aria-label="Select node to edit"]','summary');
    assert.equal(await temperature.inputValue(),'0'); assert.equal(await maxTokens.inputValue(),'64'); receipt.checks.push('restore preserves publication');
    await page.getByRole('button',{name:'Clone loop'}).click(); await page.selectOption('select[aria-label="Select node to edit"]','summary'); await page.getByRole('button',{name:'Save & publish'}).click(); await waitFor(page,'text=Revision 1 saved and enabled for chat and UI.'); receipt.checks.push('clone');
    importDirectory=await mkdtemp(join(tmpdir(),'loops-editor-import-')); const fixturePath=join(importDirectory,'definition.json'); await writeFile(fixturePath,JSON.stringify({...exportedDefinition,id:'imported-editor',slug:'imported-editor'}));
    const chooserEvent=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Import',exact:true}).click();await (await chooserEvent).setFiles(fixturePath); await waitFor(page,'text=New loop. Choose Save & publish'); await page.getByRole('button',{name:'Save draft'}).click(); await waitFor(page,'text=Revision 1 saved as a draft'); receipt.checks.push('import');
    const loopName=page.getByLabel('Loop name'),fillLoopName=async value=>{if(!await loopName.isVisible())await page.locator('details.lp-definition-settings summary').click();await loopName.fill(value);};
    await fillLoopName('QA delayed save original'); await page.evaluate(()=>globalThis.__editorRegression.deferNextDraft()); await page.getByRole('button',{name:'Save draft'}).click(); await page.waitForFunction(()=>globalThis.__editorRegression.deferredDraftCount()===1); await fillLoopName('QA delayed save newer'); await page.evaluate(()=>globalThis.__editorRegression.resolveNextDraft()); await waitFor(page,'text=Revision 2 saved; newer draft edits are retained.'); await page.waitForFunction(()=>{for(let index=0;index<globalThis.localStorage.length;index++)if(globalThis.localStorage.getItem(globalThis.localStorage.key(index))?.includes('QA delayed save newer'))return true;return false;}); assert.equal(await loopName.inputValue(),'QA delayed save newer'); await page.getByRole('button',{name:'Save draft'}).click(); await waitFor(page,'text=Revision 3 saved as a draft'); receipt.checks.push('late save success retains newer same-loop edits, its recoverable local draft, and rebases the next save');
    await fillLoopName('QA delayed failure original'); await page.evaluate(()=>globalThis.__editorRegression.deferNextDraft()); await page.getByRole('button',{name:'Save draft'}).click(); await page.waitForFunction(()=>globalThis.__editorRegression.deferredDraftCount()===1); await fillLoopName('QA delayed failure newer'); await page.evaluate(()=>globalThis.__editorRegression.rejectNextDraft('synthetic delayed transport failure')); await page.getByRole('button',{name:'Save draft'}).waitFor({state:'visible'}); await page.waitForFunction(()=>!globalThis.document.querySelector('select[aria-label="Authorized chat session"]')?.disabled); assert.equal(await loopName.inputValue(),'QA delayed failure newer'); assert.match(await page.getByRole('alert').textContent(),/earlier save failed; newer draft edits were retained/i); receipt.checks.push('late save failure retains newer local draft and reports the scoped failure');
    await page.evaluate(()=>globalThis.__editorRegression.deferNextDraft()); await page.getByRole('button',{name:'Save draft'}).click(); await page.waitForFunction(()=>globalThis.__editorRegression.deferredDraftCount()===1); await fillLoopName('QA delayed conflict newer'); await page.evaluate(()=>globalThis.__editorRegression.rejectNextDraft('revision changed')); await page.waitForFunction(()=>!globalThis.document.querySelector('select[aria-label="Authorized chat session"]')?.disabled); assert.equal(await loopName.inputValue(),'QA delayed conflict newer'); assert.equal(await page.getByRole('region',{name:'Resolve concurrent edits'}).count(),0); receipt.checks.push('late save conflict cannot replace newer draft or open a stale merge');
    await fillLoopName('QA storage rebase original'); await page.evaluate(()=>globalThis.__editorRegression.deferNextDraft()); await page.getByRole('button',{name:'Save draft'}).click(); await page.waitForFunction(()=>globalThis.__editorRegression.deferredDraftCount()===1); await fillLoopName('QA storage rebase newer'); await page.waitForFunction(()=>{for(let index=0;index<globalThis.localStorage.length;index++)if(globalThis.localStorage.getItem(globalThis.localStorage.key(index))?.includes('QA storage rebase newer'))return true;return false;}); await page.evaluate(()=>globalThis.__editorRegression.failNextLocalDraftWrite()); await page.evaluate(()=>globalThis.__editorRegression.resolveNextDraft()); await page.waitForFunction(()=>globalThis.__editorRegression.localDraftWriteFailures()===1); assert.equal(await loopName.inputValue(),'QA storage rebase newer'); assert.equal(await page.evaluate(()=>{for(let index=0;index<globalThis.localStorage.length;index++)if(globalThis.localStorage.getItem(globalThis.localStorage.key(index))?.includes('QA storage rebase newer'))return true;return false;}),true); receipt.checks.push('same-loop recovery draft survives a local-storage failure during saved-revision rebase');
    await page.getByRole('button',{name:'Save draft'}).click(); await waitFor(page,'text=Revision 5 saved as a draft'); await fillLoopName('QA switch-loop original'); await page.evaluate(()=>globalThis.__editorRegression.deferNextDraft()); await page.getByRole('button',{name:'Save draft'}).click(); await page.waitForFunction(()=>globalThis.__editorRegression.deferredDraftCount()===1); await page.locator('.lp-loop-card').filter({hasText:'Summarize text copy'}).click(); await page.waitForFunction(()=>globalThis.document.querySelector('input')&&[...globalThis.document.querySelectorAll('input')].some(input=>input.value==='Summarize text copy')); await page.evaluate(()=>globalThis.__editorRegression.resolveNextDraft()); await page.waitForFunction(()=>globalThis.__editorRegression.deferredDraftCount()===0&&!globalThis.document.querySelector('select[aria-label="Authorized chat session"]')?.disabled); assert.equal(await loopName.inputValue(),'Summarize text copy'); receipt.checks.push('late save cannot replace a different selected loop');
    await fillLoopName('QA exact conflict selection'); await page.evaluate(()=>{globalThis.__editorRegression.deferNextDraft();globalThis.__editorRegression.deferNextLoad();}); await page.getByRole('button',{name:'Save draft'}).click(); await page.waitForFunction(()=>globalThis.__editorRegression.deferredDraftCount()===1); await page.evaluate(()=>globalThis.__editorRegression.rejectNextDraft('revision changed')); await page.waitForFunction(()=>globalThis.__editorRegression.deferredLoadCount()===1); await page.locator('.lp-loop-card').first().click(); await page.waitForFunction(()=>globalThis.document.querySelector('input')&&[...globalThis.document.querySelectorAll('input')].some(input=>input.value==='Summarize text')); await page.evaluate(()=>globalThis.__editorRegression.resolveNextLoad()); await page.waitForFunction(()=>globalThis.__editorRegression.deferredLoadCount()===0&&!globalThis.document.querySelector('select[aria-label="Authorized chat session"]')?.disabled); assert.equal(await page.getByRole('region',{name:'Resolve concurrent edits'}).count(),0); assert.equal(await page.getByRole('alert').count(),0); receipt.checks.push('late conflict load cannot contaminate a newly selected loop');
    await fillLoopName('QA exact conflict conversation'); await page.evaluate(()=>{globalThis.__editorRegression.deferNextDraft();globalThis.__editorRegression.deferNextLoad();}); await page.getByRole('button',{name:'Save draft'}).click(); await page.waitForFunction(()=>globalThis.__editorRegression.deferredDraftCount()===1); await page.evaluate(()=>globalThis.__editorRegression.rejectNextDraft('revision changed')); await page.waitForFunction(()=>globalThis.__editorRegression.deferredLoadCount()===1); await page.evaluate(()=>globalThis.__editorRegression.switchConversation('agent:main:editor-browser-2')); await page.waitForFunction(()=>globalThis.document.querySelector('select[aria-label="Authorized chat session"]')?.value==='agent:main:editor-browser-2'); await page.evaluate(()=>globalThis.__editorRegression.rejectNextLoad('synthetic late conflict load failure')); await page.waitForFunction(()=>globalThis.__editorRegression.deferredLoadCount()===0&&!globalThis.document.querySelector('select[aria-label="Authorized chat session"]')?.disabled); assert.notEqual(await loopName.inputValue(),'QA exact conflict conversation'); assert.equal(await page.getByRole('region',{name:'Resolve concurrent edits'}).count(),0); assert.equal(await page.getByRole('alert').count(),0); receipt.checks.push('late conflict-load failure cannot contaminate a new same-agent conversation');
    await fillLoopName('QA scope-switch original');
    await page.evaluate(()=>globalThis.__editorRegression.deferNextDraft());
    await page.getByRole('button',{name:'Save draft'}).click();
    await page.waitForFunction(()=>globalThis.__editorRegression.deferredDraftCount()===1);
    const sharedTarget=await page.evaluate(()=>globalThis.__editorRegression.pendingDraft());
    const loadsBeforeScopeSwitch=await page.evaluate(id=>globalThis.__editorRegression.calls.filter(call=>call.id==='load'&&call.payload.id===id).length,sharedTarget.id);
    await page.evaluate(()=>globalThis.__editorRegression.switchConversation('agent:other:editor-browser'));
    await page.selectOption('select[aria-label="Agent"]','other');
    await page.waitForFunction(({id,loads})=>{
      const state=globalThis.__editorRegression,record=state.records.get(id);
      return globalThis.document.querySelector('select[aria-label="Agent"]')?.value==='other'&&
        globalThis.document.querySelector('select[aria-label="Authorized chat session"]')?.value==='agent:other:editor-browser'&&
        state.calls.filter(call=>call.id==='load'&&call.payload.id===id).length>loads&&
        globalThis.document.querySelector('details.lp-definition-settings input')?.value===record?.definition.name;
    },{id:sharedTarget.id,loads:loadsBeforeScopeSwitch});
    const beforeAck=await page.evaluate(id=>({name:globalThis.document.querySelector('details.lp-definition-settings input')?.value,notice:globalThis.document.querySelector('.lp-message')?.textContent??null,loads:globalThis.__editorRegression.calls.filter(call=>call.id==='load'&&call.payload.id===id).length}),sharedTarget.id);
    assert.notEqual(beforeAck.name,'QA scope-switch original');
    assert.equal(await page.locator('select[aria-label="Authorized chat session"]').isDisabled(),true);
    await page.evaluate(()=>{globalThis.__editorRegression.withholdNextDraftChanged();globalThis.__editorRegression.resolveNextDraft();});
    await page.waitForFunction(()=>globalThis.__editorRegression.deferredDraftCount()===0&&globalThis.__editorRegression.deferredChangedCount()===1&&!globalThis.document.querySelector('select[aria-label="Authorized chat session"]')?.disabled);
    const afterAck=await page.evaluate(()=>({name:globalThis.document.querySelector('details.lp-definition-settings input')?.value,notice:globalThis.document.querySelector('.lp-message')?.textContent??null,agent:globalThis.document.querySelector('select[aria-label="Agent"]')?.value,session:globalThis.document.querySelector('select[aria-label="Authorized chat session"]')?.value,withheld:globalThis.__editorRegression.calls.filter(call=>call.mode==='changed-withheld').length,acknowledgedDraft:globalThis.__editorRegression.calls.filter(call=>call.mode==='draft'&&call.definition.name==='QA scope-switch original').length,localDrafts:globalThis.document.querySelector('.lp-local-drafts')?.textContent??null}));
    assert.equal(afterAck.name,beforeAck.name);assert.equal(afterAck.notice,beforeAck.notice);assert.equal(afterAck.agent,'other');assert.equal(afterAck.session,'agent:other:editor-browser');assert.equal(afterAck.withheld,1);assert.equal(afterAck.acknowledgedDraft,1);assert.doesNotMatch(afterAck.localDrafts??'',/QA scope-switch original/);
    receipt.scopeSwitch={sharedId:sharedTarget.id,oldScopeAcknowledgement:{before:beforeAck,after:afterAck}};
    receipt.checks.push('late save acknowledgement cannot replace another agent or conversation scope');
    await page.evaluate(()=>globalThis.__editorRegression.releaseNextChanged());
    await page.waitForFunction(({id,loads})=>globalThis.__editorRegression.calls.filter(call=>call.id==='load'&&call.payload.id===id).length>loads&&globalThis.document.querySelector('details.lp-definition-settings input')?.value==='QA scope-switch original',{id:sharedTarget.id,loads:beforeAck.loads});
    assert.equal(await page.locator('select[aria-label="Agent"]').inputValue(),'other');assert.equal(await page.locator('select[aria-label="Authorized chat session"]').inputValue(),'agent:other:editor-browser');
    receipt.scopeSwitch.sharedDefinitionRefresh={name:await loopName.inputValue(),released:await page.evaluate(()=>globalThis.__editorRegression.calls.filter(call=>call.mode==='changed-released').length)};
    receipt.checks.push('explicit changed notification reloads the shared loop under the current agent scope');
    await page.selectOption('select[aria-label="Load an example"]','summarize-text'); await page.getByRole('button',{name:'Save draft'}).click(); await waitFor(page,'text=Revision 1 saved as a draft');
    await fillLoopName('QA undo saved snapshot'); await page.evaluate(()=>globalThis.__editorRegression.deferNextDraft()); await page.getByRole('button',{name:'Save draft'}).click(); await page.waitForFunction(()=>globalThis.__editorRegression.deferredDraftCount()===1); await fillLoopName('QA redo newer snapshot'); await page.evaluate(()=>globalThis.__editorRegression.resolveNextDraft()); await waitFor(page,'text=Revision 2 saved; newer draft edits are retained.');
    await page.getByRole('button',{name:'Undo',exact:true}).click(); assert.equal(await loopName.inputValue(),'QA undo saved snapshot'); await page.getByRole('button',{name:'Undo',exact:true}).click(); assert.equal(await loopName.inputValue(),'Summarize text'); await page.getByRole('button',{name:'Save draft'}).click(); await waitFor(page,'text=Revision 3 saved as a draft');
    await page.getByRole('button',{name:'Redo',exact:true}).click(); assert.equal(await loopName.inputValue(),'QA undo saved snapshot'); await page.getByRole('button',{name:'Save draft'}).click(); await waitFor(page,'text=Revision 4 saved as a draft'); await page.getByRole('button',{name:'Redo',exact:true}).click(); assert.equal(await loopName.inputValue(),'QA redo newer snapshot'); await page.getByRole('button',{name:'Save draft'}).click(); await waitFor(page,'text=Revision 5 saved as a draft'); assert.equal(await page.getByRole('region',{name:'Resolve concurrent edits'}).count(),0); receipt.checks.push('Undo and Redo retain authored snapshots while saving with every acknowledged revision');
    const state=await page.evaluate(()=>({calls:globalThis.__editorRegression.calls,records:[...globalThis.__editorRegression.records.entries()]})); const advanced=definition=>definition.nodes.find(node=>node.id==='summary').advanced;
    assert.equal(state.records[0][1].definition.nodes.find(node=>node.id==='summary').model,'fake/switched');
    const saved=state.calls.filter(call=>['save','draft','restore'].includes(call.mode)); assert.deepEqual(advanced(saved.find(call=>call.mode==='save'&&call.definition.revision===1).definition),{temperature:0,maxTokens:64}); assert.deepEqual(advanced(saved.find(call=>call.mode==='save'&&call.definition.revision===4).definition),{temperature:0,maxTokens:96});
    assert.equal(saved.find(call=>call.mode==='save'&&call.definition.revision===1).definition.schemaVersion,3);assert.deepEqual(saved.find(call=>call.mode==='save'&&call.definition.revision===1).definition.nodes.filter(node=>node.kind==='evaluate'||node.kind==='gate').map(node=>node.kind),['evaluate','gate']);
    assert.deepEqual(advanced(saved.find(call=>call.mode==='restore').definition),{temperature:0,maxTokens:64}); assert.deepEqual(advanced(state.records.find(([,item])=>item.definition.slug.startsWith('imported-editor-'))[1].definition),{temperature:0,maxTokens:96}); assert.equal(state.records[0][1].publishedRevision,4);assert.equal(state.records[0][1].enabledRevision,4);assert.deepEqual(advanced(saved.find(call=>call.definition.revision===2).definition),{maxTokens:64});assert.ok(!Object.hasOwn(saved.find(call=>call.definition.revision===3).definition.nodes.find(node=>node.id==='summary'),'advanced'));assert.deepEqual(state.records[1][1].definition.nodes,state.records[0][1].definition.nodes);assert.deepEqual(state.records[1][1].definition.edges,state.records[0][1].definition.edges);assert.deepEqual(receipt.errors,[]);assert.equal(await page.getByRole('alert').count(),0);
    await page.selectOption('select[aria-label="Node family"]','condition'); await page.getByRole('button',{name:'+ Add node'}).click();
    if(await page.getByRole('button',{name:'Use version 2 in this draft',exact:true}).count())await page.getByRole('button',{name:'Use version 2 in this draft',exact:true}).click();
    if(await page.getByRole('button',{name:'Use version 3 in this draft',exact:true}).count())await page.getByRole('button',{name:'Use version 3 in this draft',exact:true}).click();
    await page.getByRole('button',{name:'Use typed condition',exact:true}).click(); assert.equal(await page.getByRole('combobox',{name:/Typed comparison/}).inputValue(),'equals'); receipt.checks.push('synthetic browser: v3 equality conversion preserves the legacy operator');
    await page.getByRole('button',{name:'Remove selected node'}).click(); await page.selectOption('select[aria-label="Node family"]','condition'); await page.getByRole('button',{name:'+ Add node'}).click(); await page.getByRole('combobox',{name:/^Comparison/}).selectOption('contains'); await page.getByText(/no semantics-preserving typed conversion/i).waitFor(); assert.equal(await page.getByRole('button',{name:'Use typed condition',exact:true}).count(),0); receipt.checks.push('synthetic browser: non-equivalent legacy conditions require an explicit rewrite');
    await page.getByRole('button',{name:'Remove selected node'}).click(); await page.selectOption('select[aria-label="Node family"]','switch'); await page.getByRole('button',{name:'+ Add node'}).click();
    await page.getByLabel('Case 1 label').fill('First object'); await page.getByLabel('Case 1 typed value JSON').fill('{"outer":{"a":1,"b":[0,{"ready":false}]}}');
    await page.getByRole('button',{name:'+ Add case'}).click(); await page.getByLabel('Case 2 label').fill('Same object reordered'); await page.getByLabel('Case 2 typed value JSON').fill('{"outer":{"b":[0,{"ready":false}],"a":1}}');
    await page.locator('.lp-node-error').filter({hasText:/duplicate reachable case values/i}).waitFor(); await page.getByRole('combobox',{name:/Case matching/}).selectOption('ordered');await page.locator('.lp-node-error').filter({hasText:/duplicate reachable case values/i}).waitFor();
    await page.getByRole('button',{name:'Remove case'}).last().click();await page.locator('.lp-node-error').filter({hasText:/duplicate reachable case values/i}).waitFor({state:'detached'});
    await page.getByLabel('Use default route').check(); assert.equal(await page.getByText('Stable port ID').count()>0,true); receipt.checks.push('synthetic browser: ordered and unique Switch both reject structural duplicates until the unreachable case is removed');
    await page.getByRole('button',{name:'Remove selected node'}).click();
    await fillLoopName('QA unmount original'); await page.waitForFunction(()=>{for(let index=0;index<globalThis.localStorage.length;index++)if(globalThis.localStorage.getItem(globalThis.localStorage.key(index))?.includes('QA unmount original'))return true;return false;}); await page.evaluate(()=>globalThis.__editorRegression.deferNextDraft()); await page.getByRole('button',{name:'Save draft'}).click(); await page.waitForFunction(()=>globalThis.__editorRegression.deferredDraftCount()===1); await page.evaluate(()=>globalThis.__editorRegression.unmount()); await page.evaluate(()=>globalThis.__editorRegression.resolveNextDraft()); await page.waitForFunction(()=>globalThis.__editorRegression.deferredDraftCount()===0&&globalThis.__editorRegression.calls.some(call=>call.mode==='draft'&&call.definition.name==='QA unmount original')); assert.equal(await page.evaluate(()=>{for(let index=0;index<globalThis.localStorage.length;index++)if(globalThis.localStorage.getItem(globalThis.localStorage.key(index))?.includes('QA unmount original'))return true;return false;}),true); receipt.checks.push('late save after unmount preserves the recoverable snapshot');
    await verifyEvaluationDraftRaces(browser,url,receipt.checks);
    {
      const lifecyclePage=await browser.newPage();await lifecyclePage.goto(url);await waitFor(lifecyclePage,'select[aria-label="Load an example"]');
      await lifecyclePage.selectOption('select[aria-label="Load an example"]','summarize-text');
      await lifecyclePage.selectOption('select[aria-label="Node family"]','context-lifecycle');await lifecyclePage.getByRole('button',{name:'+ Add node'}).click();
      await lifecyclePage.getByLabel('Lifecycle write target').fill('/working');
      await lifecyclePage.getByLabel('Lifecycle selected paths').fill('/input/text');
      const lifecycleControls=lifecyclePage.locator('section[aria-label="Context lifecycle settings"]');
      await lifecycleControls.locator('.lp-value-editor select').first().selectOption('json');
      await lifecycleControls.locator('.lp-value-editor textarea').first().fill('0');
      await lifecyclePage.getByRole('button',{name:'Save draft'}).click();await lifecyclePage.getByText('Revision 1 saved as a draft').waitFor();
      let savedLifecycle=await lifecyclePage.evaluate(()=>[...globalThis.__editorRegression.records.values()].at(-1).definition);
      assert.equal(savedLifecycle.schemaVersion,3);assert.deepEqual(savedLifecycle.nodes.find(node=>node.kind==='context-lifecycle').lifecycle,{operation:'inject',target:'/working',paths:['/input/text'],value:{literalJson:'0'}});
      await lifecyclePage.evaluate(()=>globalThis.__editorRegression.refresh());await lifecyclePage.getByLabel('Lifecycle write target').waitFor();assert.equal(await lifecyclePage.getByLabel('Lifecycle write target').inputValue(),'/working');
      await lifecycleControls.locator('select').first().selectOption('compact');await lifecyclePage.getByLabel('Lifecycle selected paths').fill('/working');
      await lifecycleControls.locator('.lp-value-editor textarea').first().fill('Keep selected facts.');await lifecycleControls.locator('textarea').last().fill('Reduce selected working data.');
      await lifecyclePage.getByRole('button',{name:'Save draft'}).click();await lifecyclePage.getByText('Revision 2 saved as a draft').waitFor();
      savedLifecycle=await lifecyclePage.evaluate(()=>[...globalThis.__editorRegression.records.values()].at(-1).definition);
      assert.equal(savedLifecycle.nodes.find(node=>node.kind==='context-lifecycle').lifecycle.operation,'compact');
      assert.equal(Object.hasOwn(savedLifecycle.nodes.find(node=>node.kind==='context-lifecycle').lifecycle,'value'),false);
      await lifecycleControls.locator('select').first().selectOption('retrieve');await lifecyclePage.getByLabel('Lifecycle source',{exact:true}).selectOption('retained');
      await lifecyclePage.getByLabel('Retained source ID',{exact:true}).fill('a'.repeat(64));await lifecycleControls.locator('select').nth(2).selectOption('document');
      await lifecyclePage.getByRole('button',{name:'Save draft'}).click();await lifecyclePage.getByText('Revision 3 saved as a draft').waitFor();
      savedLifecycle=await lifecyclePage.evaluate(()=>[...globalThis.__editorRegression.records.values()].at(-1).definition);
      assert.deepEqual(savedLifecycle.nodes.find(node=>node.kind==='context-lifecycle').lifecycle.source,{kind:'retained',sourceId:'a'.repeat(64),format:'document'});
      await lifecycleControls.locator('select').first().selectOption('reset');await lifecyclePage.getByLabel('Lifecycle source',{exact:true}).selectOption('initial');
      await lifecyclePage.getByRole('button',{name:'Save draft'}).click();await lifecyclePage.getByText('Revision 4 saved as a draft').waitFor();
      savedLifecycle=await lifecyclePage.evaluate(()=>[...globalThis.__editorRegression.records.values()].at(-1).definition);
      assert.deepEqual(savedLifecycle.nodes.find(node=>node.kind==='context-lifecycle').lifecycle.source,{kind:'initial'});
      await lifecycleControls.locator('select').first().selectOption('summarize');await lifecyclePage.getByRole('button',{name:'Save draft'}).click();await lifecyclePage.getByText('Revision 5 saved as a draft').waitFor();
      savedLifecycle=await lifecyclePage.evaluate(()=>[...globalThis.__editorRegression.records.values()].at(-1).definition);
      assert.equal(savedLifecycle.nodes.find(node=>node.kind==='context-lifecycle').lifecycle.operation,'summarize');
      assert.equal(Object.hasOwn(savedLifecycle.nodes.find(node=>node.kind==='context-lifecycle').lifecycle,'source'),false);
      const lifecycleId=savedLifecycle.nodes.find(node=>node.kind==='context-lifecycle').id;
      await lifecyclePage.selectOption('select[aria-label="Connection source node"]','summary');
      await lifecyclePage.selectOption('select[aria-label="Connection target node"]',lifecycleId);
      await lifecyclePage.getByRole('button',{name:'Add connection'}).click();
      await lifecyclePage.selectOption('select[aria-label="Connection source node"]',lifecycleId);
      await lifecyclePage.selectOption('select[aria-label="Connection target node"]','return');
      await lifecyclePage.getByRole('button',{name:'Add connection'}).click();
      await lifecyclePage.selectOption('select[aria-label="Select node to edit"]',lifecycleId);
      await lifecycleControls.locator('select').first().selectOption('inject');
      assert.equal(await lifecycleControls.locator('.lp-value-editor textarea').first().inputValue(),'null');
      assert.equal(await lifecyclePage.getByRole('button',{name:'Save draft'}).isDisabled(),false);
      await lifecyclePage.getByLabel('Lifecycle source',{exact:true}).selectOption('retained');
      await lifecyclePage.getByLabel('Retained source ID',{exact:true}).fill('not-a-digest');
      await lifecyclePage.getByLabel('Run target').selectOption('draft');
      assert.equal(await lifecyclePage.getByRole('button',{name:'Save & publish'}).isDisabled(),true);
      assert.equal(await lifecyclePage.getByRole('button',{name:'Test current draft'}).isDisabled(),true);
      assert.equal(await lifecyclePage.getByLabel('Retained source ID',{exact:true}).inputValue(),'not-a-digest');
      await lifecyclePage.getByLabel('Lifecycle source',{exact:true}).selectOption('');
      assert.equal(await lifecycleControls.locator('.lp-value-editor textarea').first().inputValue(),'null');
      await lifecyclePage.getByRole('button',{name:'Save draft'}).click();await lifecyclePage.getByText('Revision 6 saved as a draft').waitFor();
      savedLifecycle=await lifecyclePage.evaluate(()=>[...globalThis.__editorRegression.records.values()].at(-1).definition);
      assert.deepEqual(savedLifecycle.nodes.find(node=>node.kind==='context-lifecycle').lifecycle.value,{literalJson:'null'});
      assert.equal(Object.hasOwn(savedLifecycle.nodes.find(node=>node.kind==='context-lifecycle').lifecycle,'source'),false);
      const downloadPromise=lifecyclePage.waitForEvent('download');await lifecyclePage.getByRole('button',{name:'Export',exact:true}).click();
      const download=await downloadPromise,exported=JSON.parse(await readFile(await download.path(),'utf8'));
      assert.deepEqual(exported.nodes.find(node=>node.kind==='context-lifecycle').lifecycle.value,{literalJson:'null'});
      await lifecyclePage.getByLabel('Run target').selectOption('draft');
      assert.equal(await lifecyclePage.getByRole('button',{name:'Test current draft'}).isDisabled(),false,JSON.stringify(await lifecyclePage.locator('.lp-node-error').allTextContents()));
      await lifecyclePage.getByRole('button',{name:'Test current draft'}).click();
      await lifecyclePage.waitForFunction(()=>globalThis.__editorRegression.calls.some(call=>call.id==='test'));
      const tested=await lifecyclePage.evaluate(()=>globalThis.__editorRegression.calls.findLast(call=>call.id==='test').payload.definition);
      assert.deepEqual(tested.nodes.find(node=>node.kind==='context-lifecycle').lifecycle.value,{literalJson:'null'});
      receipt.checks.push('synthetic browser: all five lifecycle operations author and save without stale source or value');
      receipt.checks.push('synthetic browser: summary and retained-source transitions materialize authored null for Save, Export, and draft Test while invalid source text blocks dispatch');await lifecyclePage.close();
    }
    {
      const memoryPage=await browser.newPage();await memoryPage.goto(url);await waitFor(memoryPage,'select[aria-label="Load an example"]');
      await memoryPage.selectOption('select[aria-label="Load an example"]','summarize-text');
      await memoryPage.selectOption('select[aria-label="Node family"]','memory');await memoryPage.getByRole('button',{name:'+ Add node'}).click();
      const controls=memoryPage.getByRole('region',{name:'Memory node settings'});
      await controls.getByRole('combobox',{name:'Memory operation'}).selectOption('write');
      await controls.getByRole('checkbox',{name:'Enable memory for this loop'}).check();
      await controls.getByRole('button',{name:'Add write scope'}).click();
      await controls.getByRole('textbox',{name:'Write prefix 1'}).fill('notes');
      const memorySchemaId=controls.getByRole('textbox',{name:'Schema ID'});
      await memorySchemaId.focus();await memoryPage.keyboard.type('x');
      assert.equal(await memorySchemaId.inputValue(),'notex');
      await memoryPage.keyboard.press('Backspace');
      await controls.getByRole('textbox',{name:'Schema ID'}).fill('note');
      await memoryPage.getByRole('button',{name:'Save draft'}).click();await memoryPage.getByText('Revision 1 saved as a draft').waitFor();
      let savedMemory=await memoryPage.evaluate(()=>[...globalThis.__editorRegression.records.values()].at(-1).definition);
      assert.equal(savedMemory.schemaVersion,3);assert.equal(savedMemory.memoryPolicy.enabled,true);
      assert.equal(savedMemory.nodes.find(node=>node.kind==='memory').memory.operation,'write');
      assert.equal(savedMemory.memoryPolicy.nodes[savedMemory.nodes.find(node=>node.kind==='memory').id].writeScopes[0].prefix,'notes');
      assert.equal(savedMemory.memorySchemas.length,1);
      assert.equal(savedMemory.memorySchemas.some(entry=>entry.id==='note'&&entry.version===1),true);
      const memoryEnum=controls.getByRole('textbox',{name:'Enum JSON values'});
      await memoryEnum.fill('[');
      assert.equal(await memoryPage.getByRole('button',{name:'Save draft'}).isDisabled(),true);
      assert.equal(await memoryPage.getByRole('button',{name:'Save & publish'}).isDisabled(),true);
      assert.equal(await memoryPage.getByRole('button',{name:'Export',exact:true}).isDisabled(),true);
      await controls.getByRole('button',{name:'Discard invalid enum text'}).click();
      assert.equal(await memoryEnum.inputValue(),'');
      await memoryPage.evaluate(()=>globalThis.__editorRegression.refresh());await controls.getByRole('combobox',{name:'Memory operation'}).waitFor();
      await controls.getByRole('combobox',{name:'Memory operation'}).selectOption('reset-preview');
      await controls.getByRole('textbox',{name:'Memory forget prefixes'}).fill('notes');
      await memoryPage.getByRole('button',{name:'Save draft'}).click();await memoryPage.getByText('Revision 2 saved as a draft').waitFor();
      savedMemory=await memoryPage.evaluate(()=>[...globalThis.__editorRegression.records.values()].at(-1).definition);
      assert.equal(savedMemory.nodes.find(node=>node.kind==='memory').memory.operation,'reset-preview');
      assert.deepEqual(savedMemory.memoryPolicy.nodes[savedMemory.nodes.find(node=>node.kind==='memory').id].forgetPrefixes,['notes']);
      receipt.checks.push('synthetic browser: v3 opt-in Memory write policy, versioned schema and reset preview survive save and refresh');await memoryPage.close();
    }
    {
      const fixture={schemaVersion:3,id:'memory-invalid-mounted',slug:'memory-invalid-mounted',name:'Memory invalid mounted',description:'Disposable invalid-policy draft.',revision:0,
        inputSchema:[],capabilities:[],limits:{maxExecutions:5,maxOutputBytes:8192},layout:{},
        nodes:[{id:'input',kind:'input',label:'Input'},{id:'remember',kind:'memory',label:'Remember',memory:{operation:'consume',key:'notes.fact'}},{id:'sibling',kind:'memory',label:'Sibling',memory:{operation:'consume',key:'notes.fact'}},{id:'return',kind:'return',label:'Return',value:'done'}],
        edges:[{id:'a',source:'input',target:'remember',port:'next'},{id:'b',source:'remember',target:'sibling',port:'next'},{id:'c',source:'sibling',target:'return',port:'next'}],
        memoryPolicy:{version:1,enabled:true,nodes:null}};
      const fixturePath=join(importDirectory,'memory-invalid.json');
      const loadInvalid=async(policy,name)=>{
        const page=await browser.newPage();page.setDefaultTimeout(10_000);page.on('pageerror',error=>receipt.errors.push(error.message));page.on('dialog',dialog=>void dialog.accept());
        await page.goto(url);await waitFor(page,'select[aria-label="Load an example"]');
        await writeFile(fixturePath,JSON.stringify({...fixture,name,memoryPolicy:policy}));
        const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Import',exact:true}).click();await (await chooser).setFiles(fixturePath);
        await page.getByLabel('Select node to edit',{exact:true}).selectOption('remember');
        return page;
      };
      const nullPage=await loadInvalid({version:1,enabled:true,nodes:null},'Memory null nodes');
      const nullControls=nullPage.getByRole('region',{name:'Memory node settings'});
      await nullControls.getByRole('alert').getByText(/node collection is invalid/i).waitFor();
      assert.equal(await nullPage.getByRole('button',{name:'Test current draft',exact:true}).isDisabled(),true);
      assert.equal(await nullPage.getByRole('button',{name:'Save & publish',exact:true}).isDisabled(),true);
      const beforeNull=await nullPage.evaluate(()=>globalThis.__editorRegression.calls.filter(call=>call.id==='test').length);
      await nullPage.getByRole('button',{name:'Save draft',exact:true}).click();await nullPage.getByText('Revision 1 saved as a draft').waitFor();
      const savedNull=await nullPage.evaluate(()=>[...globalThis.__editorRegression.records.values()].at(-1).definition);
      assert.equal(savedNull.memoryPolicy.nodes,null);
      await nullPage.locator('details.lp-definition-settings summary').click();
      await nullPage.locator('details.lp-definition-settings input').first().fill('Memory null nodes unsaved');
      await nullPage.waitForFunction(()=>{for(let index=0;index<globalThis.localStorage.length;index++)if(globalThis.localStorage.getItem(globalThis.localStorage.key(index))?.includes('Memory null nodes unsaved'))return true;return false;});
      await nullPage.reload();await waitFor(nullPage,'select[aria-label="Load an example"]');
      const drafts=nullPage.locator('.lp-local-drafts');await drafts.locator('summary').waitFor();
      if(!await drafts.evaluate(element=>element.open))await drafts.locator('summary').click();
      await drafts.getByRole('button',{name:/^Recover Memory null nodes unsaved draft/}).first().click();
      await nullPage.getByLabel('Select node to edit',{exact:true}).selectOption('remember');
      await nullPage.getByRole('region',{name:'Memory node settings'}).getByRole('button',{name:'Repair memory node collection'}).click();
      await nullPage.getByRole('textbox',{name:'Memory read prefixes'}).fill('notes');
      await nullPage.getByLabel('Select node to edit',{exact:true}).selectOption('sibling');
      await nullPage.getByRole('button',{name:'Repair this Memory node policy'}).click();
      await nullPage.getByRole('textbox',{name:'Memory read prefixes'}).fill('notes');
      assert.equal(await nullPage.getByRole('button',{name:'Save & publish',exact:true}).isDisabled(),false);
      // The synthetic backend is page-local; restore its last persisted record
      // after reload so this save tests the real editor revision transition.
      await nullPage.evaluate(definition=>globalThis.__editorRegression.records.set(definition.id,{definition,enabledRevision:null,publishedRevision:null,grants:definition.capabilities,revisions:{[definition.revision]:definition}}),savedNull);
      await nullPage.getByRole('button',{name:'Save & publish',exact:true}).click();await nullPage.getByText(/Revision \d+ saved and enabled for chat and UI\./).waitFor();
      assert.equal((await nullPage.evaluate(()=>globalThis.__editorRegression.calls.filter(call=>call.id==='test').length)),beforeNull);
      receipt.checks.push('synthetic browser: null Memory nodes imports and reloads unchanged, blocks dispatch, then explicit repair permits publication');
      await nullPage.close();
      const malformed={version:1,enabled:true,nodes:{remember:{readPrefixes:'notes',writeScopes:[null,{prefix:'notes',schemaId:'note',schemaVersion:1,retentionDays:30}],forgetPrefixes:null},sibling:{readPrefixes:['notes'],writeScopes:[],forgetPrefixes:[]}}};
      const malformedPage=await loadInvalid(malformed,'Memory malformed rows');
      const malformedControls=malformedPage.getByRole('region',{name:'Memory node settings'});
      await malformedControls.getByRole('alert').getByText(/invalid collections or write scopes/i).waitFor();
      await malformedPage.getByLabel('Select node to edit',{exact:true}).selectOption('sibling');
      await malformedPage.getByRole('textbox',{name:'Memory read prefixes'}).fill('notes.other');
      await malformedPage.getByLabel('Select node to edit',{exact:true}).selectOption('remember');
      const beforeRepair=await malformedPage.evaluate(()=>globalThis.__editorRegression.calls.filter(call=>call.id==='test').length);
      const exportedPromise=malformedPage.waitForEvent('download');await malformedPage.getByRole('button',{name:'Export',exact:true}).click();
      const exported=JSON.parse(await readFile(await (await exportedPromise).path(),'utf8'));
      assert.equal(exported.memoryPolicy.nodes.remember.readPrefixes,'notes');assert.equal(exported.memoryPolicy.nodes.remember.forgetPrefixes,null);
      assert.equal(exported.memoryPolicy.nodes.remember.writeScopes[0],null);assert.deepEqual(exported.memoryPolicy.nodes.sibling.readPrefixes,['notes.other']);
      assert.equal(await malformedPage.getByRole('button',{name:'Test current draft',exact:true}).isDisabled(),true);
      await malformedControls.getByRole('button',{name:'Repair read prefixes'}).click();
      await malformedControls.getByRole('button',{name:'Repair forget prefixes'}).click();
      await malformedControls.getByRole('button',{name:'Repair write scope 1'}).click();
      assert.equal((await malformedPage.evaluate(()=>globalThis.__editorRegression.calls.filter(call=>call.id==='test').length)),beforeRepair);
      receipt.checks.push('synthetic browser: malformed Memory collections and a scope row remain intact across sibling edit until explicit field repairs');
      await malformedPage.close();
      for(const [name,policy,repair] of [
        ['Memory string nodes',{version:1,enabled:true,nodes:'invalid'},'Repair memory node collection'],
        ['Memory missing read',{version:1,enabled:true,nodes:{remember:{writeScopes:[],forgetPrefixes:[]},sibling:{readPrefixes:['notes'],writeScopes:[],forgetPrefixes:[]}}},'Repair read prefixes'],
        ['Memory nonarray write',{version:1,enabled:true,nodes:{remember:{readPrefixes:['notes'],writeScopes:'notes',forgetPrefixes:[]},sibling:{readPrefixes:['notes'],writeScopes:[],forgetPrefixes:[]}}},'Repair write scopes'],
        ['Memory mixed read',{version:1,enabled:true,nodes:{remember:{readPrefixes:['notes',0],writeScopes:[],forgetPrefixes:[]},sibling:{readPrefixes:['notes'],writeScopes:[],forgetPrefixes:[]}}},'Repair read prefixes'],
      ]){
        const repairPage=await loadInvalid(policy,name);
        await repairPage.getByRole('region',{name:'Memory node settings'}).getByRole('button',{name:repair}).waitFor();
        assert.equal(await repairPage.getByRole('button',{name:'Test current draft',exact:true}).isDisabled(),true);
        assert.equal(await repairPage.getByRole('button',{name:'Save & publish',exact:true}).isDisabled(),true);
        await repairPage.close();
      }
      receipt.checks.push('synthetic browser: nonrecord nodes, missing and nonarray scope collections, and mixed prefix entries render explicit repair controls without dispatch');
    }
    {
      // F1: the mounted editor must reject every way a Summary write can
      // replace its own selected live values, while keeping the draft editable.
      const overlapPage=await browser.newPage();overlapPage.setDefaultTimeout(10_000);
      overlapPage.on('pageerror',error=>receipt.errors.push(error.message));
      let expectedReload=false;
      overlapPage.on('dialog',dialog=>{if(expectedReload&&dialog.type()==='beforeunload')void dialog.accept();else{receipt.errors.push(`Unexpected overlap dialog: ${dialog.type()}`);void dialog.dismiss();}});
      const fixture={schemaVersion:3,id:'lifecycle-overlap-mounted',slug:'lifecycle-overlap-mounted',name:'Lifecycle overlap mounted',description:'Disposable F1 authoring regression.',revision:0,
        inputSchema:[{name:'data',label:'Data',type:'json',required:true}],capabilities:[],limits:{maxExecutions:4,maxOutputBytes:16384},
        nodes:[{id:'input',kind:'input',label:'Input'},{id:'step',kind:'context-lifecycle',label:'Lifecycle',lifecycle:{operation:'inject',target:'/summary',paths:['/working'],value:{literalJson:'null'}}},{id:'return',kind:'return',label:'Return',value:'{{nodes.step.contextVersion}}'}],
        edges:[{id:'input-step',source:'input',target:'step',port:'next'},{id:'step-return',source:'step',target:'return',port:'next'}],layout:{}};
      const fixturePath=join(importDirectory,'lifecycle-overlap.json');await writeFile(fixturePath,JSON.stringify(fixture));
      await overlapPage.goto(url);await waitFor(overlapPage,'select[aria-label="Load an example"]');
      const chooser=overlapPage.waitForEvent('filechooser');await overlapPage.getByRole('button',{name:'Import',exact:true}).click();await (await chooser).setFiles(fixturePath);
      await overlapPage.locator('.lp-canvas-heading h2').getByText(fixture.name,{exact:true}).waitFor();
      await overlapPage.getByLabel('Select node to edit',{exact:true}).selectOption('step');
      const lifecycle=overlapPage.locator('section[aria-label="Context lifecycle settings"]');
      await lifecycle.getByRole('combobox',{name:'Operation',exact:true}).selectOption('summarize');
      await lifecycle.locator('.lp-value-editor textarea').first().fill('Summarize only the selected facts.');
      const target=overlapPage.getByLabel('Lifecycle write target',{exact:true}),paths=overlapPage.getByLabel('Lifecycle selected paths',{exact:true});
      let conflict;
      for(const scenario of [
        {name:'equal',target:'/working',paths:'/working'},
        {name:'ancestor',target:'/working',paths:'/working/fact'},
        {name:'descendant',target:'/working/fact',paths:'/working'},
      ]){
        await target.fill(scenario.target);await paths.fill(scenario.paths);
        assert.equal(await target.inputValue(),scenario.target);assert.equal(await paths.inputValue(),scenario.paths);
        const exportedPromise=overlapPage.waitForEvent('download');await overlapPage.getByRole('button',{name:'Export',exact:true}).click();
        const exported=JSON.parse(await readFile(await (await exportedPromise).path(),'utf8'));
        const authored=exported.nodes.find(node=>node.id==='step').lifecycle;
        assert.equal(authored.operation,'summarize');assert.equal(authored.target,scenario.target);assert.deepEqual(authored.paths,[scenario.paths]);
        const issue=overlapPage.locator('.lp-issues button').filter({hasText:/Summarize.*target.*selected path/i});
        await issue.waitFor();const message=await issue.innerText();
        assert.match(message,/disjoint target/i);if(conflict)assert.equal(message,conflict);else conflict=message;
        assert.equal(await overlapPage.getByRole('button',{name:'Test current draft',exact:true}).isDisabled(),true);
        assert.equal(await overlapPage.getByRole('button',{name:'Save & publish',exact:true}).isDisabled(),true);
        receipt.checks.push(`synthetic browser: Summary ${scenario.name} target overlap explains the conflict and blocks Test/Publish`);
      }
      await target.fill('/working');await paths.fill('/working');
      await overlapPage.waitForFunction(name=>{
        for(let index=0;index<globalThis.localStorage.length;index++){
          const key=globalThis.localStorage.key(index);if(!key?.startsWith('loops-editor:v2:'))continue;
          try{const draft=JSON.parse(globalThis.localStorage.getItem(key));if(draft.definition?.name===name&&draft.definition.nodes?.find(node=>node.id==='step')?.lifecycle?.target==='/working')return true;}catch{ /* Skip unrelated malformed local drafts. */ }
        }
        return false;
      },fixture.name);
      expectedReload=true;await overlapPage.reload();expectedReload=false;await waitFor(overlapPage,'select[aria-label="Load an example"]');
      const drafts=overlapPage.locator('.lp-local-drafts');await drafts.locator('summary').waitFor();
      if(!await drafts.evaluate(element=>element.open))await drafts.locator('summary').click();
      await drafts.getByRole('button',{name:/^Recover Lifecycle overlap mounted draft/}).first().click();
      await overlapPage.getByLabel('Select node to edit',{exact:true}).selectOption('step');
      assert.equal(await overlapPage.getByLabel('Lifecycle write target',{exact:true}).inputValue(),'/working');
      assert.equal(await overlapPage.getByLabel('Lifecycle selected paths',{exact:true}).inputValue(),'/working');
      await overlapPage.locator('.lp-issues button').filter({hasText:conflict}).waitFor();
      assert.equal(await overlapPage.getByRole('button',{name:'Test current draft',exact:true}).isDisabled(),true);
      await overlapPage.getByLabel('Lifecycle write target',{exact:true}).fill('/summary');
      await overlapPage.locator('.lp-issues button').filter({hasText:conflict}).waitFor({state:'detached'});
      assert.equal(await overlapPage.getByRole('button',{name:'Test current draft',exact:true}).isDisabled(),false);
      assert.equal(await overlapPage.getByRole('button',{name:'Save & publish',exact:true}).isDisabled(),false);
      await overlapPage.getByRole('button',{name:'Save draft',exact:true}).click();
      await overlapPage.getByText('Revision 1 saved as a draft').waitFor();
      const saved=await overlapPage.evaluate(()=>[...globalThis.__editorRegression.records.values()].at(-1).definition);
      assert.equal(saved.nodes.find(node=>node.id==='step').lifecycle.operation,'summarize');
      assert.equal(saved.nodes.find(node=>node.id==='step').lifecycle.target,'/summary');
      assert.deepEqual(saved.nodes.find(node=>node.id==='step').lifecycle.paths,['/working']);
      assert.equal((await overlapPage.evaluate(()=>globalThis.__editorRegression.calls.filter(call=>call.id==='test').length)),0);
      receipt.checks.push('synthetic browser: invalid Summary overlap survives local recovery and disjoint repair restores valid authoring');
      await overlapPage.close();
    }
    receipt.definitions=state.records.map(([id,item])=>({id,revision:item.definition.revision,enabledRevision:item.enabledRevision,publishedRevision:item.publishedRevision,advanced:advanced(item.definition)}));
    receipt.operations=state.calls.filter(call=>call.mode||call.id).map(call=>call.mode??call.id); receipt.passed=true;
  } catch(error){receipt.failure=error.message;if(receiptPath)await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n');throw error;} finally { await browser?.close(); if(importDirectory)await rm(importDirectory,{recursive:true,force:true}); await new Promise(resolve=>server.close(resolve)); }
  if(receiptPath)await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n'); return receipt;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await (process.argv[2]==='schema-drafts'?runDataSchemaDraftRegression():process.argv[2]==='schema-renames'?runDataSchemaRenameRegression():process.argv[2]==='switch-drafts'?runSwitchCaseDraftRegression():process.argv[2]==='schema-history'?runUnvisitedSchemaHistoryRegression():process.argv[2]==='timeout-version'?runTimeoutVersionRegression():process.argv[2]==='branching-review'?runBranchingReviewRegression():runEditorAdvancedRegression()),null,2));
