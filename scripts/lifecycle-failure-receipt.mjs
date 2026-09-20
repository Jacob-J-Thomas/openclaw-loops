import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const phases=new Set(['archive-validation','install-previous','backup-previous','upgrade','uninstall-reinstall','matching-predecessor-restore']);
const descriptions={
  'storage-full':'Lifecycle storage capacity was exhausted.',
  'permission-denied':'Lifecycle access was denied by the operating system.',
  'required-file-missing':'A required lifecycle file was unavailable.',
  timeout:'A lifecycle operation timed out.',
  connection:'A lifecycle connection failed.',
  invariant:'A lifecycle verification invariant failed.',
  'subprocess-exit':'A lifecycle subprocess exited unsuccessfully.',
  unexpected:'Lifecycle verification failed unexpectedly.',
};

function category(error){
  const code=typeof error?.code==='string'?error.code:'';
  if(code==='ENOSPC')return 'storage-full';
  if(code==='EACCES'||code==='EPERM')return 'permission-denied';
  if(code==='ENOENT')return 'required-file-missing';
  if(code==='ETIMEDOUT'||/timed out|timeout/i.test(String(error?.message??'')))return 'timeout';
  if(['ECONNREFUSED','ECONNRESET','EPIPE'].includes(code))return 'connection';
  if(code==='ERR_ASSERTION')return 'invariant';
  if(typeof error?.status==='number'||typeof error?.signal==='string')return 'subprocess-exit';
  return 'unexpected';
}

export function lifecycleFailureReceipt(phase,error){
  const safeCategory=category(error);
  return {status:'failed',phase:phases.has(phase)?phase:'unknown',category:safeCategory,message:descriptions[safeCategory]};
}

export function writeLifecycleFailureReceipt(directory,phase,error){
  mkdirSync(directory,{recursive:true});
  const receipt=lifecycleFailureReceipt(phase,error);
  writeFileSync(resolve(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  return receipt;
}
