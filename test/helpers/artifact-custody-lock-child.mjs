// Dedicated native process for artifact custody OS-lease tests.
import {writeSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const [modulePath,root,mode,id]=process.argv.slice(2);
const {ArtifactCustody}=await import(pathToFileURL(modulePath).href);
const owner={agentId:'agent',sessionKey:'session',sessionId:'generation'};
const store=new ArtifactCustody(root);
if(mode==='hold'){
  store.withCoordinationLease(()=>{
    writeSync(1,'HELD\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60_000);
  });
}else if(mode==='probe'){
  try{store.list(owner);writeSync(1,JSON.stringify({status:'free'})+'\n');}
  catch(error){writeSync(1,JSON.stringify({status:'blocked',code:error.code})+'\n');}
}else if(mode==='inspect'){
  writeSync(1,JSON.stringify({status:'inspected',readback:store.inspectRecovery(owner,[id]),total:store.list(owner).total})+'\n');
}else throw Error('Unknown custody process mode.');
