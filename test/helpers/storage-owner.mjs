// Subprocess fixture: execute the real bundled storage adapter, with optional
// pauses at filesystem boundaries. No hooks are added to the production code.
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
const fs=createRequire(import.meta.url)('node:fs');
const [file,bundle,mode,ready,release,stateFile]=process.argv.slice(2);
const pause=()=>{
  fs.writeFileSync(ready,'paused');
  const deadline=Date.now()+10000,word=new Int32Array(new SharedArrayBuffer(4));
  while(!fs.existsSync(release)&&Date.now()<deadline)Atomics.wait(word,0,0,10);
  if(!fs.existsSync(release))throw new Error('Fixture release timed out.');
};
if(mode==='stale-removal'){
  const remove=fs.rmSync;let paused=false;
  fs.rmSync=(target,options)=>{
    if(target===file+'.lock'&&!paused){paused=true;pause();}
    return remove(target,options);
  };
}else if(mode==='publish-owner'){
  const rename=fs.renameSync;
  fs.renameSync=(source,target)=>{if(target===file+'.lock')pause();return rename(source,target);};
}
syncBuiltinESMExports();
let store;
process.on('message',async message=>{
  if(message==='stop'){
    try{await store?.close();process.exitCode=0;}catch{process.exitCode=1;}
    process.disconnect();
  }
});
try{
  const {SqliteStorage}=await import(pathToFileURL(bundle).href);
  store=new SqliteStorage(file);
  if(stateFile)store.write(JSON.parse(fs.readFileSync(stateFile,'utf8')));
  process.send({state:'owned',pid:process.pid,snapshot:store.read()});
}catch(error){process.send({state:'rejected',pid:process.pid,error:error.message});}
