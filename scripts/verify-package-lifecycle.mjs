import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {cpSync,createWriteStream,existsSync,lstatSync,mkdirSync,readFileSync,readlinkSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createConnection} from 'node:net';
import {resolve as pathResolve} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {createLifecycleOperations,lifecycleChildProcessState,writeLifecycleFailureReceipt} from './lifecycle-failure-receipt.mjs';
import {GATEWAY_STARTUP_BUDGET_MS,observeGatewayReadiness} from './gateway-readiness-evidence.mjs';

const evidence=pathResolve(process.env.LOOPS_EVIDENCE_DIR??'evidence','package-lifecycle');
let previous,current,previousSource,previousSha,currentSha,raw,profile,client,clientStartup;
let hosts,completed=false,phase='archive-validation',readiness,restartOrdinal=-1,gatewayStartedAt=0;
let lifecycleFailure,primaryDiagnostic;
const operations=createLifecycleOperations(()=>({phase,restartOrdinal}));
const {begin:beginOperation,complete:completeOperation,abandon:abandonOperation,record:operationRecord,run:observeOperation}=operations;
beginOperation('archive-validation');
let stop=async()=>{};
try{
 raw=pathResolve('.dev-profile',`package-lifecycle-evidence-${randomUUID()}`);
 [previous,current]=process.argv.slice(2);
 previousSource=process.env.LOOPS_LIFECYCLE_PREVIOUS_REF;
 const previousHostRoot=process.env.LOOPS_LIFECYCLE_PREVIOUS_HOST_ROOT;
 const expectedHostVersions={previous:process.env.LOOPS_LIFECYCLE_EXPECTED_PREVIOUS_HOST_VERSION,current:process.env.LOOPS_LIFECYCLE_EXPECTED_CURRENT_HOST_VERSION};
 assert(previous&&current,'Usage: node scripts/verify-package-lifecycle.mjs <previous.tgz> <current.tgz>');
 assert(previousSource,'LOOPS_LIFECYCLE_PREVIOUS_REF must identify the source used to build the previous archive.');
 assert(previousHostRoot,'LOOPS_LIFECYCLE_PREVIOUS_HOST_ROOT must identify the project containing the matching previous OpenClaw host.');

 profile=pathResolve('.dev-profile',`package-lifecycle-${randomUUID()}`);
 const worker=pathResolve('test/helpers/gateway-client-worker.mjs');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
 previousSha=hash(previous);currentSha=hash(current);
 assert.notEqual(previousSha,currentSha,'Upgrade requires distinct archive bytes.');
const host=name=>{
  const root=pathResolve(name==='previous'?previousHostRoot:process.env.LOOPS_LIFECYCLE_CURRENT_HOST_ROOT??'.');
  const openclawRoot=pathResolve(root,'node_modules/openclaw');
  const manifestPath=pathResolve(openclawRoot,'package.json');
  const manifest=JSON.parse(readFileSync(manifestPath));
  const clientRequire=createRequire(pathResolve(root,'package.json'));
  const clientModule=clientRequire.resolve('openclaw/plugin-sdk/gateway-runtime');
  return {name,root,cli:pathResolve(openclawRoot,'openclaw.mjs'),manifestPath,version:manifest.version,clientModule};
};
hosts={previous:host('previous'),current:host('current')};
for(const name of ['previous','current'])if(expectedHostVersions[name])assert.equal(hosts[name].version,expectedHostVersions[name],`Lifecycle ${name} host version does not match the requested qualification.`);
const hostIdentity=value=>({version:value.version,packageSha256:hash(value.manifestPath),cliSha256:hash(value.cli),clientSha256:hash(value.clientModule)});
const write=(name,value)=>writeFileSync(pathResolve(evidence,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
const inventory=(directory,prefix='')=>Object.fromEntries(readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{const file=pathResolve(directory,entry.name);return entry.isSymbolicLink()?[[prefix+entry.name,`symlink:${readlinkSync(file)}`]]:entry.isDirectory()?Object.entries(inventory(file,prefix+entry.name+'/')):[[prefix+entry.name,hash(file)]];}));
const archiveBoundary=file=>{const files=execFileSync('tar',['-tzf',file],{encoding:'utf8'}).trim().split('\n').filter(name=>name!=='package/').map(name=>name.replace(/^package\//,''));const manifest=JSON.parse(execFileSync('tar',['-xOf',file,'package/package.json'],{encoding:'utf8'})),allowed=new Set(['package.json',...manifest.files]);for(const name of files)assert([...allowed].some(entry=>name===entry||name.startsWith(entry+'/')),`Published archive contains path outside package.json files: ${name}`);return {count:files.length,files};};
mkdirSync(evidence,{recursive:true});
mkdirSync(raw,{recursive:true,mode:0o700});
const port=Number(process.env.LOOPS_LIFECYCLE_PORT??20991),token=randomBytes(32).toString('hex');
assert.equal(spawnSync('lsof',['-t',`-iTCP:${port}`,'-sTCP:LISTEN'],{encoding:'utf8'}).status,1,`Lifecycle port ${port} is already listening.`);
mkdirSync(pathResolve(profile,'workspace'),{recursive:true,mode:0o700});
const config={gateway:{mode:'local',bind:'loopback',port,auth:{mode:'token',token},controlUi:{experimental:{customPlugins:true}}},discovery:{mdns:{mode:'off'}},browser:{enabled:false},cron:{enabled:false},logging:{file:pathResolve(profile,'gateway.log')},agents:{defaults:{workspace:pathResolve(profile,'workspace'),heartbeat:{every:'0m'}}},plugins:{entries:{}}};
writeFileSync(pathResolve(profile,'openclaw.json'),JSON.stringify(config,null,2)+'\n',{mode:0o600});
const env={...process.env,OPENCLAW_CONFIG_PATH:pathResolve(profile,'openclaw.json'),OPENCLAW_STATE_DIR:pathResolve(profile,'state')};
const runCli=(selected,...args)=>execFileSync(process.execPath,[selected.cli,...args],{cwd:selected.root,env,encoding:'utf8',maxBuffer:8*1024*1024});
const install=(selected,archive)=>{beginOperation('installer');const result=runCli(selected,'plugins','install',`npm-pack:${pathResolve(archive)}`,'--force','--accept-capabilities');completeOperation();return result;};
const installedRoot=selected=>pathResolve(JSON.parse(runCli(selected,'plugins','info','loops-poc','--json')).plugin.rootDir);
const installations=[];
const archiveRegularFiles=new Map();
const regularFiles=archive=>{
  const archiveSha=hash(archive),cached=archiveRegularFiles.get(archiveSha);if(cached)return cached;
  const files=new Map(execFileSync('tar',['-tvzf',archive],{encoding:'utf8'}).trim().split('\n').filter(line=>line.startsWith('-')).map(line=>{const match=line.match(/\s(package\/.+)$/);assert(match,`Could not read regular archive path: ${line}`);const file=match[1].replace(/^package\//,'');return [file,execFileSync('tar',['-xOf',archive,'package/'+file],{maxBuffer:16*1024*1024})];}));
  archiveRegularFiles.set(archiveSha,files);return files;
};
const verifyFilesAtRoot=(root,archive,otherArchive)=>{
  const expectedFiles=regularFiles(archive),otherFiles=regularFiles(otherArchive),files=[...expectedFiles].map(([file,expected])=>{
    const installed=pathResolve(root,file);assert(lstatSync(installed).isFile(),`Installed archive path is not a regular file: ${file}`);
    assert.deepEqual(readFileSync(pathResolve(root,file)),expected);
    return {file,sha256:createHash('sha256').update(expected).digest('hex')};
  });
  const obsoletePathsAbsent=[...otherFiles.keys()].filter(file=>!expectedFiles.has(file));
  for(const file of obsoletePathsAbsent)assert.throws(()=>lstatSync(pathResolve(root,file)),{code:'ENOENT'},`Installed obsolete archive path remains: ${file}`);
  return {files,obsoletePathsAbsent};
};
const verifyInstalled=(selected,archive,otherArchive)=>{
  beginOperation('installed-file-validation');
  const info=JSON.parse(runCli(selected,'plugins','info','loops-poc','--json'));
  assert.equal(info.plugin.id,'loops-poc');
  assert(pathResolve(info.plugin.rootDir).startsWith(pathResolve(profile,'state')+'/'));
  const {files,obsoletePathsAbsent}=verifyFilesAtRoot(info.plugin.rootDir,archive,otherArchive);
  installations.push({host:selected.version,archiveSha256:hash(archive),files,obsoletePathsAbsent});
  completeOperation();
};
const protectedConfig=()=>{const value=JSON.parse(readFileSync(pathResolve(profile,'openclaw.json'))),plugin=value.plugins??{};return JSON.stringify({gateway:value.gateway,agents:value.agents,models:value.models,tools:value.tools,auth:value.auth,logging:value.logging,bindings:value.bindings,channels:value.channels,skills:value.skills,env:value.env,pluginEntry:plugin.entries?.['loops-poc']});};
const childState={child:null},startupTimings=[];
const start=selected=>{restartOrdinal++;gatewayStartedAt=Date.now();const child=spawn(process.execPath,[selected.cli,'gateway','run','--port',String(port),'--compact'],{cwd:selected.root,env,stdio:['ignore','ignore','pipe']});child.stderr.pipe(createWriteStream(pathResolve(raw,`${selected.name}-gateway.log`),{flags:'a',mode:0o600}));childState.child=child;return child;};
stop=async()=>{const child=childState.child;if(!child)return false;if(child.exitCode!==null||child.signalCode!==null){childState.child=null;return false;}const wait=signal=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`Gateway did not exit after ${signal}.`)),5000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill(signal);});try{await wait('SIGTERM');}catch{await wait('SIGKILL');}childState.child=null;return true;};
const probe=async(timeoutMs=1000)=>await new Promise((resolve,reject)=>{const socket=createConnection({host:'127.0.0.1',port});let settled=false;const finish=(callback,value)=>{if(settled)return;settled=true;socket.destroy();callback(value);};socket.setTimeout(timeoutMs,()=>finish(reject,Error('Gateway readiness probe timed out.')));socket.once('connect',()=>finish(resolve));socket.once('error',error=>finish(reject,error));});
const waitForListening=async()=>{const deadline=Date.now()+GATEWAY_STARTUP_BUDGET_MS;let lastError;while(Date.now()<deadline){const child=childState.child;if(!child||child.exitCode!==null||child.signalCode!==null)throw Error('Gateway exited before listening.');try{await probe(Math.max(1,Math.min(1000,deadline-Date.now())));if(Date.now()>deadline)break;startupTimings.push({phase,restartOrdinal,budgetMs:GATEWAY_STARTUP_BUDGET_MS,listeningElapsedMs:Date.now()-gatewayStartedAt});return;}catch(error){lastError=error;await pause(Math.min(100,Math.max(0,deadline-Date.now())));}}readiness=await observeGatewayReadiness({child:childState.child,probe:async timeoutMs=>{try{await probe(timeoutMs);return true;}catch{return false;}},startedAt:gatewayStartedAt,restartOrdinal,remainingMs:()=>45000,pause});throw Error(`Gateway did not listen: ${String(lastError?.message??lastError)}`);};
const connect=async selected=>await new Promise((resolve,reject)=>{const clientStartedAt=Date.now(),startupBudgetMs=15_000,child=spawn(process.execPath,[worker],{cwd:selected.root,env:{...env,LOOPS_GATEWAY_CLIENT_PROJECT_ROOT:selected.root,LOOPS_GATEWAY_URL:`ws://127.0.0.1:${port}`,LOOPS_GATEWAY_TOKEN:token},stdio:['ignore','ignore','pipe','ipc']});clientStartup={restartOrdinal,budgetMs:startupBudgetMs,listening:true,gatewayProcessState:lifecycleChildProcessState(childState.child),clientProcessState:lifecycleChildProcessState(child),elapsedMs:0,timings:[]};child.stderr.pipe(createWriteStream(pathResolve(raw,`${selected.name}-client.log`),{flags:'a',mode:0o600}));let settled=false,next=0;const pending=new Map(),snapshot=()=>{clientStartup={...clientStartup,gatewayProcessState:lifecycleChildProcessState(childState.child),clientProcessState:lifecycleChildProcessState(child),elapsedMs:Date.now()-clientStartedAt};};const clear=()=>{clearTimeout(timer);for(const {reject,timer} of pending.values()){clearTimeout(timer);reject(Error('Client worker exited.'));}pending.clear();};const fail=error=>{if(settled)return;settled=true;snapshot();clear();child.kill('SIGTERM');reject(error);};const timer=setTimeout(()=>fail(Error('Gateway client startup timed out.')),startupBudgetMs);const request=(method,params,timeoutMs=60000)=>new Promise((resolve,reject)=>{const id=++next,requestTimer=setTimeout(()=>{pending.delete(id);reject(Error(`Gateway request timed out: ${method}`));},timeoutMs);pending.set(id,{resolve,reject,timer:requestTimer});child.send({type:'request',id,method,params,timeoutMs});});const stopAndWait=()=>new Promise((resolve,reject)=>{if(child.exitCode!==null||child.signalCode!==null){resolve();return;}const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Gateway client worker did not exit.'));},5000);child.once('exit',()=>{clearTimeout(timeout);resolve();});child.send({type:'stop'});});child.on('message',message=>{if(message?.type==='timing'&&Array.isArray(clientStartup?.timings)&&clientStartup.timings.length<8){clientStartup.timings.push(message.timing);}else if(message?.type==='ready'&&!settled){settled=true;snapshot();clearTimeout(timer);resolve({request,stopAndWait});}else if(message?.type==='error')fail(Error(message.message));else if(message?.type==='result'){const entry=pending.get(message.id);pending.delete(message.id);if(entry){clearTimeout(entry.timer);if(message.error)entry.reject(Error(message.error));else entry.resolve(message.result);}}});child.once('error',fail);child.once('exit',()=>{if(!settled)fail(Error('Gateway client worker exited before ready.'));else clear();});});
const action=async(client,session,actionId,payload={})=>{return observeOperation('public-session-actions',async()=>{const response=await client.request('plugins.sessionAction',{pluginId:'loops-poc',actionId,agentId:'main',sessionKey:session.key,payload});assert.equal(response.ok,true,JSON.stringify(response));return response.result;});};
const definition={slug:`package-lifecycle-${randomUUID().slice(0,8)}`,name:'Package lifecycle verification',description:'Disposable public API lifecycle fixture.',inputSchema:[{name:'value',label:'Value',type:'number',required:true}],capabilities:[],nodes:[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'{{input.value}}'}],edges:[{id:'next',source:'input',target:'return',port:'next'}],layout:{input:{x:0,y:0},return:{x:260,y:0}},limits:{maxExecutions:3,maxOutputBytes:4096}};
const pluginState=pathResolve(profile,'state','loops-poc');
  const boundaries={previous:archiveBoundary(previous),current:archiveBoundary(current)};completeOperation();
  const identities={previous:hostIdentity(hosts.previous),current:hostIdentity(hosts.current)};
  phase='install-previous';
  writeFileSync(pathResolve(raw,'install-previous.txt'),install(hosts.previous,previous),{mode:0o600});
  verifyInstalled(hosts.previous,previous,current);
  beginOperation('state-validation');const configBeforeUpgrade=protectedConfig();completeOperation();
  await observeOperation('gateway-readiness',async()=>{start(hosts.previous);await waitForListening();},{restartOrdinal:restartOrdinal+1});client=await observeOperation('sdk-client-startup',()=>connect(hosts.previous));
  const session=await observeOperation('public-session-actions',()=>client.request('sessions.create',{agentId:'main',label:`Package lifecycle ${randomUUID()}`}));
  const created=await action(client,session,'create',{definition,enabled:true});
  const run=await action(client,session,'run',{slug:definition.slug,input:{value:71},requestId:randomUUID()});
  beginOperation('state-validation');assert.equal(run.state,'completed');assert.equal(run.result,71);completeOperation();
  const originalRun=await action(client,session,'inspect',{runId:run.id});
  await observeOperation('client-shutdown',()=>client.stopAndWait());client=null;await observeOperation('gateway-shutdown',stop);

  phase='backup-previous';beginOperation('profile-backup');
  const backup=pathResolve(raw,'matched-stopped-predecessor-backup');mkdirSync(backup,{recursive:true,mode:0o700});
  cpSync(profile,pathResolve(backup,'profile'),{recursive:true,verbatimSymlinks:true});
  cpSync(previous,pathResolve(backup,'application.tgz'));
  writeFileSync(pathResolve(backup,'host.json'),JSON.stringify(identities.previous,null,2)+'\n',{mode:0o600});
  assert.equal(hash(pathResolve(backup,'application.tgz')),previousSha);
  const backupInventory=inventory(pathResolve(backup,'profile'));
  completeOperation();

  phase='upgrade';
  writeFileSync(pathResolve(raw,'install-current.txt'),install(hosts.current,current),{mode:0o600});
  beginOperation('state-validation');assert.equal(protectedConfig(),configBeforeUpgrade,'Upgrade changed protected operator settings.');completeOperation();
  verifyInstalled(hosts.current,current,previous);
  await observeOperation('gateway-readiness',async()=>{start(hosts.current);await waitForListening();},{restartOrdinal:restartOrdinal+1});client=await observeOperation('sdk-client-startup',()=>connect(hosts.current));
  const upgraded=await action(client,session,'load',{id:created.record.definition.id});
  const upgradedRun=await action(client,session,'inspect',{runId:run.id});
  beginOperation('state-validation');assert.deepEqual(upgraded,created.record);assert.deepEqual(upgradedRun,originalRun);completeOperation();
  await observeOperation('client-shutdown',()=>client.stopAndWait());client=null;await observeOperation('gateway-shutdown',stop);

  phase='uninstall-reinstall';
  beginOperation('state-validation');const stateBeforeUninstall=inventory(pluginState);assert(existsSync(pathResolve(pluginState,'loops.sqlite')),'Expected plugin storage path is absent before uninstall.');completeOperation();
  beginOperation('installer');runCli(hosts.current,'plugins','uninstall','loops-poc','--force');completeOperation();
  beginOperation('state-validation');assert.deepEqual(inventory(pluginState),stateBeforeUninstall,'Uninstall changed retained plugin state.');completeOperation();
  writeFileSync(pathResolve(raw,'install-clean-reinstall.txt'),install(hosts.current,current),{mode:0o600});
  beginOperation('state-validation');const afterReinstall=JSON.parse(readFileSync(env.OPENCLAW_CONFIG_PATH));
  assert.equal(afterReinstall.plugins.entries['loops-poc'].enabled,false,'Reinstall must preserve the host disable marker left by uninstall.');completeOperation();
  beginOperation('installer');writeFileSync(pathResolve(raw,'enable-reinstalled.txt'),runCli(hosts.current,'plugins','enable','loops-poc'),{mode:0o600});completeOperation();
  beginOperation('state-validation');assert.equal(protectedConfig(),configBeforeUpgrade);completeOperation();verifyInstalled(hosts.current,current,previous);
  await observeOperation('gateway-readiness',async()=>{start(hosts.current);await waitForListening();},{restartOrdinal:restartOrdinal+1});client=await observeOperation('sdk-client-startup',()=>connect(hosts.current));
  assert.deepEqual(await action(client,session,'load',{id:created.record.definition.id}),created.record);
  assert.deepEqual(await action(client,session,'inspect',{runId:run.id}),originalRun);
  await observeOperation('client-shutdown',()=>client.stopAndWait());client=null;await observeOperation('gateway-shutdown',stop);

  phase='matching-predecessor-restore';beginOperation('profile-restore');
  const currentProfileBeforeRollback=pathResolve(raw,'current-profile-before-rollback');
  renameSync(profile,currentProfileBeforeRollback);
  cpSync(pathResolve(backup,'profile'),profile,{recursive:true,verbatimSymlinks:true});
  assert.deepEqual(inventory(profile),backupInventory,'Rollback did not restore the complete stopped predecessor profile.');
  completeOperation();
  verifyInstalled(hosts.previous,previous,current);
  beginOperation('rollback-staging');
  const rollbackPluginRoot=installedRoot(hosts.previous);
  assert(rollbackPluginRoot.startsWith(pathResolve(profile,'state')+'/'),'Rollback plugin installation must remain inside the disposable profile.');
  rmSync(rollbackPluginRoot,{recursive:true,force:true});mkdirSync(rollbackPluginRoot,{recursive:true,mode:0o700});
  execFileSync('tar',['-xzf',pathResolve(current),'--strip-components=1','-C',rollbackPluginRoot]);
  verifyFilesAtRoot(rollbackPluginRoot,current,previous);completeOperation();
  writeFileSync(pathResolve(raw,'install-rollback-previous.txt'),install(hosts.previous,pathResolve(backup,'application.tgz')),{mode:0o600});
  beginOperation('state-validation');assert.equal(protectedConfig(),configBeforeUpgrade);completeOperation();verifyInstalled(hosts.previous,previous,current);
  await observeOperation('gateway-readiness',async()=>{start(hosts.previous);await waitForListening();},{restartOrdinal:restartOrdinal+1});client=await observeOperation('sdk-client-startup',()=>connect(hosts.previous));
  assert.deepEqual(await action(client,session,'inspect',{runId:run.id}),originalRun);
  assert.deepEqual(await action(client,session,'load',{id:created.record.definition.id}),created.record);
  await observeOperation('client-shutdown',()=>client.stopAndWait());client=null;await observeOperation('gateway-shutdown',stop);

  beginOperation('receipt-write');
  write('receipt.json',{previous:{source:previousSource,sha256:previousSha,fileCount:boundaries.previous.count,expectedHostVersion:expectedHostVersions.previous??null,host:identities.previous,cliVersion:runCli(hosts.previous,'--version').trim()},current:{sha256:currentSha,fileCount:boundaries.current.count,expectedHostVersion:expectedHostVersions.current??null,host:identities.current,cliVersion:runCli(hosts.current,'--version').trim()},rollbackArchiveSha256:previousSha,ordinaryInstallerRollback:true,rollbackInstallerReplacedCurrentBytes:true,node:process.version,profileConfigSha256:hash(pathResolve(profile,'openclaw.json')),profileInventoryEntries:Object.keys(backupInventory).length,loopId:created.record.definition.id,runId:run.id,fixtureOnly:true,noModelCalls:true,upgradePreserved:true,uninstallRetainedState:true,reinstallPreservedHostDisable:true,explicitPublicHostEnable:true,cleanReinstallPreserved:true,matchedStoppedRestore:true,matchedStoppedFullProfileRestore:true,matchingPublicCliAndClient:true,gatewayStartups:startupTimings,operationOutcomes:operations.completed(),installations});
  completeOperation();completed=true;
}catch(error){
  lifecycleFailure=error;
  primaryDiagnostic=operations.snapshot();
}finally{
  let cleanupError,cleanupDiagnostic;
  try{if(client){beginOperation('client-shutdown');await client.stopAndWait();completeOperation();}}catch(error){cleanupError??=error;cleanupDiagnostic??=operationRecord('failed');}
  try{beginOperation('gateway-shutdown');const stopped=await stop();if(stopped)completeOperation();else abandonOperation();}catch(error){cleanupError??=error;cleanupDiagnostic??=operationRecord('failed');}
  const primaryError=lifecycleFailure??cleanupError;
  if(primaryError){
    writeLifecycleFailureReceipt(evidence,phase,primaryError,{previous:{source:previousSource,sha256:previousSha,hostVersion:hosts?.previous?.version},current:{sha256:currentSha,hostVersion:hosts?.current?.version}},readiness,{...(primaryDiagnostic??{...cleanupDiagnostic,completedOperations:operations.completed()}),clientStartup,cleanupError:lifecycleFailure?cleanupError:undefined,cleanup:cleanupDiagnostic});
    let privateDiagnosticRetained=false;
    if(raw)try{mkdirSync(raw,{recursive:true,mode:0o700});writeFileSync(pathResolve(raw,'failure.txt'),String(primaryError?.stack??primaryError),{mode:0o600});privateDiagnosticRetained=true;}catch{/* The sanitized receipt remains the authoritative failure artifact. */}
    console.error(`Package lifecycle verification failed during ${phase}; private diagnostic evidence ${privateDiagnosticRetained?'was retained':'could not be retained'}.`);
    process.exitCode=1;
  }else if(completed&&profile)rmSync(profile,{recursive:true,force:true});
}
