import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {collectContract,github,repository,validateContract} from './verify-aidlc.mjs';

export const requiredChecks=['AIDLC contract',...['ubuntu-latest','macos-latest'].flatMap(os=>['24.16.0','26.1.0'].map(node=>`verify (${os}, ${node})`))];

export function validateChecks(response,head){
  if(!Array.isArray(response.check_runs)||!Number.isSafeInteger(response.total_count)||response.total_count>100)throw new Error('Complete current check metadata is required.');
  const latest=new Map();
  for(const check of [...response.check_runs].sort((a,b)=>b.id-a.id))if(check.head_sha===head&&!latest.has(check.name))latest.set(check.name,check);
  for(const name of requiredChecks){const check=latest.get(name);if(!check||check.status!=='completed'||check.conclusion!=='success')throw new Error(`Current required check is not successful: ${name}`);}
  return requiredChecks.map(name=>{const check=latest.get(name);return {name,id:check.id,url:check.details_url};});
}

// Review is still an independent owner decision. Supplying these exact SHAs
// attests that the owner reconciled the review and dispositions for this diff.
// This wrapper enforces fresh mutable metadata rather than trusting old CI.
export async function mergeCandidate(number,reviewed,{request=github,merge=mergeOnGithub,collect=collectContract}={}){
  const checkContract=async()=>{
    const result=validateContract(await collect(number,request));
    if(!result.ok)throw new Error(result.errors.join(' '));
    if(result.head!==reviewed.head||result.base!==reviewed.base)throw new Error('The candidate differs from the owner-reviewed head/base.');
    if(result.reviewRequests<1)throw new Error('A recorded independent review is required.');
    return result;
  };
  await checkContract();
  const checks=validateChecks(await request(`repos/${repository}/commits/${reviewed.head}/check-runs?per_page=100`),reviewed.head);
  const final=await checkContract();
  // GitHub provides an atomic expected-head guard, but no atomic compare for
  // every issue field/base. Keep this read immediately adjacent to the merge;
  // do not queue auto-merge or claim a past workflow snapshot is current.
  const result=await merge(number,reviewed.head);
  if(!result.merged)throw new Error('GitHub did not confirm the merge. Inspect its current state before retrying.');
  return {...final,checks,merge:result};
}

function mergeOnGithub(number,head){
  return JSON.parse(execFileSync('gh',['api',`repos/${repository}/pulls/${number}/merge`,'--method','PUT','--input','-'],{encoding:'utf8',input:JSON.stringify({sha:head,merge_method:'merge'}),stdio:['pipe','pipe','pipe']}));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [, ,number,head,base]=process.argv;
  try{
    if(!/^[a-f0-9]{40}$/.test(head??'')||! /^[a-f0-9]{40}$/.test(base??''))throw new Error('Usage: node scripts/merge-aidlc.mjs <PR> <reviewed head SHA> <reviewed base SHA>');
    console.log(JSON.stringify(await mergeCandidate(Number(number),{head,base}),null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
