// Optional Linux integration check. Use an empty, dedicated tmpfs of at most
// 64 MiB; the guard below refuses ordinary filesystems and non-empty targets.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {closeSync,copyFileSync,existsSync,mkdtempSync,openSync,readdirSync,rmSync,statfsSync,unlinkSync,writeFileSync,writeSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const [target,report]=process.argv.slice(2);
assert(target&&report,'Usage: node scripts/verify-filesystem-full.mjs <empty dedicated tmpfs> <report.json>');
const directory=resolve(target),destination=resolve(report);
const capacity=statfsSync(directory);
assert.equal(process.platform,'linux','This check requires a dedicated Linux tmpfs.');
assert.equal(capacity.type,0x01021994,'Refusing to fill a filesystem that is not tmpfs.');
assert(capacity.blocks*capacity.bsize<=64*1024*1024,'Refusing to fill more than 64 MiB.');
assert.deepEqual(readdirSync(directory),[],'The fault filesystem must be empty.');
assert(!destination.startsWith(directory+'/'),'Write the evidence outside the fault filesystem.');
const code=mkdtempSync(join(tmpdir(),'loops-filesystem-code-')),filler=join(directory,'synthetic-filler');
let engine,store,effects=0;
try{
  await build({stdin:{contents:"export {Engine} from './src/engine.ts'; export {SqliteStorage} from './src/storage.ts'; export {examples} from './src/examples.ts';",resolveDir:resolve('.')},outfile:join(code,'code.mjs'),bundle:true,platform:'node',format:'esm',target:'node24'});
  copyFileSync('src/storage-worker.mjs',join(code,'storage-worker.mjs'));
  const {Engine,SqliteStorage,examples}=await import(pathToFileURL(join(code,'code.mjs')).href);
  const actor={agentId:'main',sessionKey:'agent:main:filesystem-fault',sessionId:'synthetic-filesystem-fault',source:'tool',human:false,check:()=>{}};
  const host={check:()=>{},modelInfo:async()=>({}),complete:async()=>{effects++;return {text:'Explicit recovery completed.'};}};
  store=new SqliteStorage(join(directory,'loops.sqlite'));engine=new Engine(store,host);
  const definition={...structuredClone(examples[0]),schemaVersion:2,limits:{maxExecutions:20,maxOutputBytes:65536}};
  const before=store.read(),fd=openSync(filler,'wx',0o600);
  let fillerBytes=0,fillError;
  try{while(true)fillerBytes+=writeSync(fd,Buffer.alloc(4096,0x61));}
  catch(error){fillError=error.code;if(fillError!=='ENOSPC')throw error;}
  finally{closeSync(fd);}
  const full=statfsSync(directory);assert.equal(full.bavail,0);
  let rejected;
  try{await engine.test(actor,definition,{text:'Synthetic input '.repeat(1500)},'failed-full-filesystem');}
  catch(error){rejected={message:error.message,code:error.code};}
  assert(rejected,'Admission unexpectedly succeeded on the full filesystem.');
  assert.match(rejected.message,/full|storage/i);
  assert.equal(effects,0,'A host effect ran without a committed admission.');
  assert.deepEqual(store.read(),before,'The failed transaction changed committed application state.');
  unlinkSync(filler);
  await engine.close();engine=undefined;store=undefined;
  store=new SqliteStorage(join(directory,'loops.sqlite'));
  assert.deepEqual(store.read(),before,'Reopening changed the previously committed state.');
  engine=new Engine(store,host);
  const recovered=await engine.test(actor,definition,{text:'Explicit new request after freeing space.'},'recovered-filesystem');
  assert.equal(recovered.state,'completed');assert.equal(effects,1);
  assert.equal(recovered.result,'Explicit recovery completed.');
  const integrity=store.integrity();assert.deepEqual(integrity,[{integrity_check:'ok'}]);
  const result={node:process.version,platform:process.platform,arch:process.arch,filesystem:'tmpfs',capacityBytes:capacity.blocks*capacity.bsize,fillerBytes,fillError,freeBlocksAtFailure:full.bavail,rejected,committedStateUnchanged:true,effectsBeforeRecovery:0,effectsAfterRecovery:effects,recoveryState:recovered.state,integrity};
  mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}finally{
  if(existsSync(filler))unlinkSync(filler);
  if(engine)await engine.close();else if(store)await store.close();
  rmSync(code,{recursive:true,force:true});
}
