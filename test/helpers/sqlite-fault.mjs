// Loaded with --import by the disposable process and its real storage worker.
// Exercise SQLite failures/commit boundaries without a production fault API.
import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
const control=process.env.LOOPS_TEST_SQLITE_CONTROL,ready=process.env.LOOPS_TEST_SQLITE_READY;
const execute=DatabaseSync.prototype.exec;
function mode(){return control&&existsSync(control)?readFileSync(control,'utf8'):'';}
function pause(){
  writeFileSync(ready,'SQLite commit boundary reached',{flush:true});
  const deadline=Date.now()+10000,word=new Int32Array(new SharedArrayBuffer(4));
  while(Date.now()<deadline)Atomics.wait(word,0,0,50);
  throw new Error('The SQLite fault fixture was not terminated.');
}
DatabaseSync.prototype.exec=function(sql){
  const fault=mode();
  if(sql==='BEGIN IMMEDIATE'){
    if(fault==='full')execute.call(this,`PRAGMA max_page_count=${this.prepare('PRAGMA page_count').get().page_count}`);
    else if(fault==='recovered')execute.call(this,'PRAGMA max_page_count=1073741823');
  }
  if(fault==='rollback-failure'&&sql==='COMMIT')throw new Error('Injected failure before COMMIT');
  if(fault==='rollback-failure'&&sql==='ROLLBACK')throw new Error('Injected rollback failure');
  if(sql==='COMMIT'&&fault==='before-commit')pause();
  const result=execute.call(this,sql);
  if(sql==='COMMIT'&&fault==='after-commit')pause();
  return result;
};
