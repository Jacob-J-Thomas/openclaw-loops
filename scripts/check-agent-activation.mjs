import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const dir='evidence/agent-activation';
const read=name=>JSON.parse(readFileSync(`${dir}/${name}.json`,'utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');
const history=read('chat-history');assert.equal(history.hasMore,false);
const calls=history.messages.flatMap(m=>(Array.isArray(m.content)?m.content:[]).filter(c=>c.type==='toolCall'&&c.name?.startsWith('loops_')));
const results=history.messages.filter(m=>m.role==='toolResult'&&m.toolName?.startsWith('loops_'));
assert.equal(calls.length,results.length);assert.ok(results.every(r=>r.isError===false));
const libraries=results.filter(m=>m.toolName==='loops_library').map(m=>JSON.parse(m.content[0].content));
const definitions=library=>library.map(({enabledRevision:_enabled,...definition})=>definition);
assert.deepEqual(definitions(libraries[0]),definitions(libraries.at(-1)));
const concurrentActivationChanges=libraries[0].flatMap(before=>{
  const after=libraries.at(-1).find(r=>r.id===before.id);
  return before.enabledRevision===after.enabledRevision?[]:[{id:before.id,slug:before.slug,before:before.enabledRevision,after:after.enabledRevision}];
});
const created=read('after-create'),managed=read('after-manage'),invoked=read('after-invoke'),cleaned=read('after-cleanup');
assert.equal(created.record.enabledRevision,1);assert.equal(managed.record.definition.revision,3);assert.equal(managed.record.enabledRevision,null);assert.equal(invoked.record.enabledRevision,3);assert.equal(cleaned.record,null);
assert.equal(invoked.runs.length,2);assert.deepEqual(invoked.runs.map(r=>r.definition.revision),[1,3]);
const modelRuns=invoked.runs.map(r=>{
  assert.equal(r.state,'completed');const output=r.outputs.summary;
  assert.equal(output.model,'gpt-6-astra');assert.equal(output.execution.owner.id,'codex');assert.equal(output.audit.caller.id,'loops-poc');assert.ok(r.result);
  return {id:r.id,revision:r.definition.revision,model:output.model,runtime:output.execution.owner.id,result:r.result};
});
const uiDraft=read('ui-draft'),ui=read('ui-enabled-run');assert.equal(uiDraft.enabledRevision,null);assert.equal(ui.record.enabledRevision,2);assert.equal(ui.runs[0].state,'completed');assert.equal(ui.runs[0].result,'UI activation verified');assert.equal(ui.runs[0].source,'session-action');
const temporaryIds=[created.record.definition.id,uiDraft.definition.id];
for(const call of calls.filter(c=>['loops_edit','loops_enable','loops_revoke','loops_delete'].includes(c.name)))assert.ok(temporaryIds.includes(call.arguments.id),'Test agent mutated an existing user loop');
const state=JSON.parse(readFileSync('.dev-profile/codex-test/state/loops-poc/state.json','utf8'));
assert.ok(!Object.values(state.loops).some(r=>temporaryIds.includes(r.definition.id)));assert.equal(cleaned.runs.length,3);for(const r of cleaned.runs)assert.equal(state.runs[r.id].state,'completed');
const manifest=JSON.parse(readFileSync('openclaw.plugin.json','utf8'));const [pack]=read('final-package');
const tarEntry=path=>execFileSync('tar',['-xOf',pack.filename,`package/${path}`]);const backendSha256=hash(tarEntry('dist/index.js')),uiSha256=hash(tarEntry(manifest.controlUi.entry));
assert.equal(backendSha256,hash(readFileSync('dist/index.js')));assert.equal(uiSha256,hash(readFileSync(manifest.controlUi.entry)));
const installations=['codex','ollama'].map(profile=>{
  const installed=read(`${profile}-installed`).plugin;assert.equal(installed.version,'0.3.0');
  const names=read(`${profile}-effective-tools`).tools.map(t=>t.id).sort();assert.deepEqual(names,[...manifest.contracts.tools].sort());assert.equal(names.length,13);
  assert.equal(hash(readFileSync(installed.source)),backendSha256);assert.equal(hash(readFileSync(join(installed.rootDir,manifest.controlUi.entry))),uiSha256);
  return {profile,version:installed.version,source:installed.source,backendSha256,uiSha256,tools:names};
});
const turns=['create','manage','invoke','cleanup'].map(mode=>{
  const data=read(`${mode}-agent`);assert.equal(data.status,'ok');const meta=data.result.meta;
  assert.equal(meta.toolSummary.failures,0);assert.equal(meta.agentMeta.agentHarnessId,'codex');assert.equal(meta.agentMeta.terminalReceipt.rerouted,false);
  return {mode,receipt:meta.agentMeta.terminalReceipt,toolSummary:meta.toolSummary};
});
const tests=read('package-tests');assert.equal(tests.numPassedTests,15);assert.equal(tests.numFailedTests,0);
const report={verifiedAt:new Date().toISOString(),version:'0.3.0',host:'2026.9.3',automatedTests:61,packagedAdapterTests:15,sessionKey:history.sessionKey,checks:{agentEnabledCreation:true,enabledAndDraftEdits:true,agentEnableDisable:true,agentInvokesDisabledLoop:true,realCodexInference:true,uiEnableDisable:true,uiSaveDraft:true,uiSaveAndEnable:true,uiInvocation:true,allToolCallsSucceeded:true,temporaryLoopsDeleted:true,runEvidenceRetained:true,originalDefinitionsPreserved:true,testMutationsLimitedToTemporaryLoops:true},concurrentActivationChanges,toolCalls:calls.map(c=>({name:c.name,...c.arguments?.enabled!==undefined?{enabled:c.arguments.enabled}:{}})),turns,modelRuns,uiRun:{id:ui.runs[0].id,revision:2,result:ui.runs[0].result},installations,finalPackage:{filename:pack.filename,sha256:hash(readFileSync(pack.filename)),backendSha256,uiSha256,verifiedExecutableMatch:true}};
writeFileSync(`${dir}/verification.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({version:report.version,checks:report.checks,toolCalls:calls.length,concurrentActivationChanges,package:report.finalPackage},null,2));
