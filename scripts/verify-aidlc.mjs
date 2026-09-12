import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const repository='Jacob-J-Thomas/openclaw-loops';
const kinds=['bolt','uow','phase','campaign'];
const issueKinds=issue=>(issue.labels??[]).map(label=>typeof label==='string'?label:label.name).filter(label=>label.startsWith('type:'));

// This gate checks the delivery contract, not whether a review or test proves
// the patch correct. The delivery owner still reconciles exact-head evidence.
export function validateContract(snapshot){
  const {pr,closing,chain,leafChildren,reviewRequestIds}=snapshot,errors=[];
  if(pr.state!=='open')errors.push('The candidate PR must be open.');
  if(pr.draft)errors.push('Draft PRs are outside the owner-approved delivery process.');
  if(pr.base.ref!=='main')errors.push('Each PR must target main directly.');
  if(pr.base.repo.full_name!==repository)errors.push('The PR targets a different repository.');
  if(!/^[a-f0-9]{40}$/.test(pr.head.sha)||! /^[a-f0-9]{40}$/.test(pr.base.sha))errors.push('Exact candidate head and base are required.');
  if(closing.length!==1)errors.push('Use one GitHub closing reference to exactly one scoped Bolt issue.');
  if(closing.some(issue=>issue.repository!==repository))errors.push('The closing issue must belong to this plugin repository.');
  if(chain.length!==4)errors.push('The native hierarchy must be Campaign -> Phase -> UOW -> Bolt.');
  if(leafChildren.length)errors.push('A Bolt must be a leaf with no sub-issues.');
  if(new Set(chain.map(issue=>issue.number)).size!==chain.length)errors.push('The native hierarchy contains a cycle.');
  if(closing.length===1&&chain[0]?.number!==closing[0].number)errors.push('The native chain does not describe the closing issue.');
  for(let index=0;index<chain.length;index++){
    const issue=chain[index];
    if(issue.state!=='open')errors.push(`Issue #${issue.number} is closed while this work is active.`);
    if(issue.pull_request)errors.push(`PR #${issue.number} cannot own an issue contract.`);
    if(JSON.stringify(issueKinds(issue))!==JSON.stringify(['type:'+kinds[index]]))errors.push(`Issue #${issue.number} must have only type:${kinds[index]}.`);
    if(issue.parentNumber!==(chain[index+1]?.number??null))errors.push(`Issue #${issue.number} has inconsistent native parentage.`);
  }
  const reviewRequests=new Set(reviewRequestIds).size;
  if(reviewRequests>3)errors.push('The maximum of three Codex review requests has been exceeded.');
  return {ok:errors.length===0,errors,issue:closing.length===1?closing[0].number:null,head:pr.head.sha,base:pr.base.sha,reviewRequests};
}

export const isCodexReview=review=>review.user?.login==='chatgpt-codex-connector[bot]'&&review.state!=='PENDING';
export const trustedReceipt=comment=>comment.user?.login?.toLowerCase()===repository.split('/')[0].toLowerCase()||comment.author_association==='COLLABORATOR';
export function reviewRequests(prComments,issueComments,reviews=[]){
  const receipts=issueComments.filter(trustedReceipt);
  const requests=new Set(prComments.filter(comment=>trustedReceipt(comment)&&/^\s*@codex\s+review\b/im.test(comment.body??'')).map(comment=>String(comment.id)));
  const results=new Set(reviews.filter(isCodexReview).map(review=>String(review.id))),summaries=new Set();
  for(const comment of prComments){
    if(comment.user?.login!=='chatgpt-codex-connector[bot]'||!(comment.body??'').includes('<!-- codex-pull-request-review-summary -->'))continue;
    if(comment.body.split('\n').some(line=>line.includes('**Code Review**')&&/\|\s*PR opened\s*\|/.test(line)))summaries.add(String(comment.id));
  }
  for(const comment of receipts){
    for(const match of (comment.body??'').matchAll(/<!-- loops-review-request:(\d+) -->/g))requests.add(match[1]);
    for(const match of (comment.body??'').matchAll(/<!-- loops-review-auto:(?:(summary|review):)?(\d+) -->/g))(match[1]==='summary'?summaries:results).add(match[2]);
  }
  // A summary and formal review are different observations until their exact
  // causal relationship is recorded. Same-commit or time proximity proves none.
  const roots=new Set([...requests,...[...summaries].map(id=>'summary:'+id)]),byRoot=new Map(),byResult=new Map();
  const pair=(root,result)=>{
    if(!roots.has(root)||!results.has(result))return;
    if(!byRoot.has(root))byRoot.set(root,new Set());byRoot.get(root).add(result);
    if(!byResult.has(result))byResult.set(result,new Set());byResult.get(result).add(root);
  };
  for(const comment of receipts){
    for(const match of (comment.body??'').matchAll(/<!-- loops-review-result:(\d+):(\d+) -->/g))pair(match[1],match[2]);
    for(const match of (comment.body??'').matchAll(/<!-- loops-review-auto-result:(\d+):(\d+) -->/g))pair('summary:'+match[1],match[2]);
  }
  for(const [result,owners] of byResult)if(owners.size===1&&byRoot.get([...owners][0]).size===1)results.delete(result);
  return [...roots,...[...results].map(id=>'review:'+id)];
}

export async function github(endpoint,{body,optional=false}={}){
  const token=process.env.GITHUB_TOKEN;
  if(token){
    const response=await globalThis.fetch('https://api.github.com/'+endpoint,{method:body?'POST':'GET',headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28',...body?{'Content-Type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{}});
    if(response.status===404&&optional)return null;
    if(!response.ok)throw new Error(`GitHub metadata read failed (${response.status}).`);
    return response.json();
  }
  const args=['api',endpoint];if(body)args.push('--method','POST','--input','-');
  try{return JSON.parse(execFileSync('gh',args,{encoding:'utf8',input:body?JSON.stringify(body):undefined,stdio:['pipe','pipe','pipe'],maxBuffer:16*1024*1024}));}
  catch(error){if(optional&&String(error.stderr).includes('(HTTP 404)'))return null;throw new Error('GitHub metadata read failed; verify gh authentication and repository access.',{cause:error});}
}

export async function collectContract(number,request=github){
  if(!Number.isSafeInteger(number)||number<1)throw new Error('A positive PR number is required.');
  const route=`repos/${repository}`,pr=await request(`${route}/pulls/${number}`);
  const [owner,name]=repository.split('/');
  // Ask GitHub which issues this PR actually closes, including references it
  // recognizes in commits. A local body regex is not authoritative parentage.
  const result=await request('graphql',{body:{query:'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences(first:100){nodes{number repository{nameWithOwner}} pageInfo{hasNextPage}}}}}',variables:{owner,name,number}}});
  const references=result.data?.repository?.pullRequest?.closingIssuesReferences;
  if(result.errors?.length||!references||references.pageInfo.hasNextPage)throw new Error('Complete GitHub closing-issue metadata is required.');
  const closing=references.nodes.map(issue=>({number:issue.number,repository:issue.repository.nameWithOwner}));
  const chain=[];let leafChildren=[],issueComments=[];
  const pages=async path=>{
    const all=[];
    for(let page=1;page<=100;page++){
      const values=await request(`${route}/${path}?per_page=100&page=${page}`);all.push(...values);
      if(values.length<100)return all;
    }
    throw new Error('Metadata pagination exceeded its documented 10,000-record budget.');
  };
  if(closing.length===1&&closing[0].repository===repository){
    let issue=await request(`${route}/issues/${closing[0].number}`);
    leafChildren=await request(`${route}/issues/${issue.number}/sub_issues?per_page=1`);
    issueComments=await pages(`issues/${issue.number}/comments`);
    for(let depth=0;issue&&depth<4;depth++){
      const parent=await request(`${route}/issues/${issue.number}/parent`,{optional:true});
      chain.push({...issue,parentNumber:parent?.number??null});issue=parent;
    }
  }
  const reviews=await pages(`pulls/${number}/reviews`);
  const ids=reviewRequests(await pages(`issues/${number}/comments`),issueComments,reviews);
  const latest=await request(`${route}/pulls/${number}`);
  if(latest.head.sha!==pr.head.sha||latest.base.sha!==pr.base.sha||latest.body!==pr.body||latest.state!==pr.state||latest.draft!==pr.draft)throw new Error('The PR changed during validation. Rerun against its current head/base.');
  return {pr,closing,chain,leafChildren,reviewRequestIds:ids};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const event=process.env.GITHUB_EVENT_PATH?JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')):undefined;
    const number=Number(process.argv[2]??event?.pull_request?.number);
    if(process.env.GITHUB_REPOSITORY&&process.env.GITHUB_REPOSITORY!==repository)throw new Error('This gate belongs to the Loops repository.');
    const snapshot=await collectContract(number);
    if(event?.pull_request?.head.sha&&event.pull_request.head.sha!==snapshot.pr.head.sha)throw new Error('This workflow event targets an obsolete PR head.');
    const result=validateContract(snapshot);console.log(JSON.stringify(result,null,2));
    if(!result.ok)process.exitCode=1;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
