import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const [file,bundle,scenario,initialFile,updatedFile]=process.argv.slice(2);
const {SqliteStorage}=await import(pathToFileURL(bundle).href);
const initial=JSON.parse(readFileSync(initialFile,'utf8')),updated=JSON.parse(readFileSync(updatedFile,'utf8'));
const store=new SqliteStorage(file);
let closed=false;
try{
  store.write(initial);writeFileSync(process.env.LOOPS_TEST_SQLITE_CONTROL,scenario);
  if(scenario==='full'){
    let error;
    try{store.write(updated);}catch(failure){error=failure.message;}
    const afterFailure=store.read();
    writeFileSync(process.env.LOOPS_TEST_SQLITE_CONTROL,'recovered');store.write(updated);
    console.log(JSON.stringify({error,afterFailure,afterRecovery:store.read(),integrity:store.integrity()}));
  }else if(scenario==='rollback-failure'){
    let error,readError;
    try{store.write(updated);}catch(failure){error=failure.message;}
    try{store.read();}catch(failure){readError=failure.message;}
    try{await store.close();}catch{/* This failed store must still terminate. */}finally{closed=true;}
    writeFileSync(process.env.LOOPS_TEST_SQLITE_CONTROL,'recovered');
    const reopened=new SqliteStorage(file);
    try{console.log(JSON.stringify({error,readError,afterRecovery:reopened.read(),integrity:reopened.integrity()}));}
    finally{await reopened.close();}
  }else{
    store.write(updated);throw new Error('The requested SQLite checkpoint was not reached.');
  }
}finally{if(!closed)await store.close();}
