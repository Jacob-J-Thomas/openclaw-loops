// Test-only syscall fault points loaded into disposable setup processes.
// Partial writes touch real files; SIGKILL uses the actual process boundary.
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const target=process.env.LOOPS_TEST_PROFILE_FILE,mode=process.env.LOOPS_TEST_PROFILE_FAULT;
const write=fs.writeFileSync,rename=fs.renameSync,link=fs.linkSync;
fs.writeFileSync=function(file,bytes,...options){
  const name=String(file),backup=name.startsWith(target+'.before-loops-');
  const replacement=name===target||(name.startsWith(target+'.')&&name.endsWith('.tmp')&&!backup);
  if((replacement&&['partial-error','partial-kill'].includes(mode))||(backup&&mode==='backup-error')){
    write(file,Buffer.from(bytes).subarray(0,7),...options);
    if(mode==='partial-kill')process.kill(process.pid,'SIGKILL');
    throw Object.assign(new Error('Injected failure after a real partial write.'),{code:'ENOSPC'});
  }
  const result=write(file,bytes,...options);
  if(backup&&mode==='external-edit')write(target,'{"external":"winner"}\n');
  return result;
};
fs.renameSync=function(from,to){
  if(to===target){
    if(mode==='before-commit')process.kill(process.pid,'SIGKILL');
    if(mode==='rename-error')throw Object.assign(new Error('Injected rename failure.'),{code:'EACCES'});
  }
  const result=rename(from,to);
  if(to===target&&mode==='after-commit')process.kill(process.pid,'SIGKILL');
  return result;
};
fs.linkSync=function(from,to){
  if(to===target&&mode==='create-race')write(target,'{"external":"winner"}\n',{flag:'wx'});
  return link(from,to);
};
syncBuiltinESMExports();
