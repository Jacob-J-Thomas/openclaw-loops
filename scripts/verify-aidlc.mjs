import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const repository='Jacob-J-Thomas/openclaw-loops';
export const featureBase='codex/post-1.0-local-expansion';
const kinds=['bolt','uow','phase','campaign'];
const issueKinds=issue=>(issue.labels??[]).map(label=>typeof label==='string'?label:label.name).filter(label=>label.startsWith('type:'));

function boltMarkers(body=''){
  const values=[...body.matchAll(/<!--\s*loops-bolt:(\d+)\s*-->/g)].map(match=>Number(match[1]));
  return {values,malformed:/<!--\s*loops-bolt:(?!\d+\s*-->)/.test(body)};
}

function singleMarker(body,name){
  const values=[...body.matchAll(new RegExp(`<!--\\s*${name}:([^\\n<>]+?)\\s*-->`,'g'))].map(match=>match[1].trim());
  return values.length===1?values[0]:null;
}

export function reviewAccounting(prComments,issueComments,reviews=[],candidate={}){
  const receipts=issueComments.filter(trustedReceipt),errors=[];
  const requests=new Set(prComments.filter(comment=>trustedReceipt(comment)&&/^\s*@codex\s+review\b/im.test(comment.body??'')).map(comment=>String(comment.id)));
  const results=new Set(reviews.filter(isCodexReview).map(review=>String(review.id))),summaries=new Set(),agents=new Map();
  for(const comment of prComments){
    if(comment.user?.login!=='chatgpt-codex-connector[bot]'||!(comment.body??'').includes('<!-- codex-pull-request-review-summary -->'))continue;
    if(comment.body.split('\n').some(line=>line.includes('**Code Review**')&&/\|\s*PR opened\s*\|/.test(line)))summaries.add(String(comment.id));
  }
  for(const comment of receipts){
    for(const match of (comment.body??'').matchAll(/<!-- loops-review-request:(\d+) -->/g))requests.add(match[1]);
    for(const match of (comment.body??'').matchAll(/<!-- loops-review-auto:(?:(summary|review):)?(\d+) -->/g))(match[1]==='summary'?summaries:results).add(match[2]);
    const matches=[...(comment.body??'').matchAll(/<!--\s*loops-agent-review:([^\s<>]+)\s*-->/g)];
    if(!matches.length)continue;
    if(matches.length!==1){errors.push('A delegated review receipt must contain exactly one unique review ID.');continue;}
    const id=matches[0][1],reviewer=singleMarker(comment.body,'loops-agent-reviewer'),reviewHead=singleMarker(comment.body,'loops-agent-review-head'),reviewBase=singleMarker(comment.body,'loops-agent-review-base'),evidence=singleMarker(comment.body,'loops-agent-review-evidence');
    if(!reviewer||!reviewHead||!reviewBase||!evidence||!/^[a-f0-9]{40}$/.test(reviewHead)||!/^[a-f0-9]{40}$/.test(reviewBase)){errors.push(`Delegated review ${id} must record one reviewer, exact head/base, and evidence.`);continue;}
    if(candidate.author&&reviewer.toLowerCase()===candidate.author.toLowerCase()){errors.push(`Delegated review ${id} must name an independent reviewer.`);continue;}
    const identity=`${reviewer}\n${reviewHead}\n${reviewBase}\n${evidence}`;
    if(agents.has(id)&&agents.get(id)!==identity){errors.push(`Delegated review ${id} has conflicting identity, head/base, or evidence.`);continue;}
    agents.set(id,identity);
  }
  // A summary and formal review are different observations until their exact
  // causal relationship is recorded. Same-commit or time proximity proves none.
  const roots=new Set([...requests,...[...summaries].map(id=>'summary:'+id),...[...agents.keys()].map(id=>'agent:'+id)]),byRoot=new Map(),byResult=new Map();
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
  return {ids:[...roots,...[...results].map(id=>'review:'+id)],errors};
}

// This gate checks the delivery contract, not whether a review or test proves
// the patch correct. The delivery owner still reconciles exact-head evidence.
export function validateContract(snapshot){
  const {pr,closing,chain,leafChildren,reviewRequestIds,reviewErrors=[],openCandidates=[]}=snapshot,errors=[];
  const featureTarget=pr.base.ref===featureBase,marker=boltMarkers(pr.body??'');
  if(pr.state!=='open')errors.push('The candidate PR must be open.');
  if(pr.draft)errors.push('Draft PRs are outside the owner-approved delivery process.');
  if(pr.base.ref!=='main'&&!featureTarget)errors.push(`A candidate PR must target main or ${featureBase}.`);
  if(pr.base.repo.full_name!==repository)errors.push('The PR targets a different repository.');
  if(!/^[a-f0-9]{40}$/.test(pr.head.sha)||! /^[a-f0-9]{40}$/.test(pr.base.sha))errors.push('Exact candidate head and base are required.');
  let issueNumber=null;
  if(marker.malformed||marker.values.length>1||new Set(marker.values).size!==marker.values.length)errors.push('The feature Bolt ownership marker is malformed or ambiguous.');
  if(featureTarget){
    if(marker.values.length!==1)errors.push(`A PR targeting ${featureBase} requires exactly one <!-- loops-bolt:<number> --> marker.`);
    else issueNumber=marker.values[0];
    if(closing.length>1||closing.some(issue=>issue.repository!==repository)||closing.length===1&&closing[0].number!==issueNumber)errors.push('Any GitHub closing reference on a feature PR must identify its marked local Bolt.');
    if(closing[0]?.candidates?.some(candidate=>candidate.repository!==repository||candidate.number!==pr.number))errors.push('A GitHub closing reference identifies another active Bolt candidate.');
  }else{
    if(closing.length!==1)errors.push('Use one GitHub closing reference to exactly one scoped Bolt issue.');
    if(closing.some(issue=>issue.repository!==repository))errors.push('The closing issue must belong to this plugin repository.');
    if(closing.length===1){const issue=closing[0];issueNumber=issue.number;if(issue.moreCandidates!==false||issue.candidates?.length!==1||issue.candidates[0].number!==pr.number||issue.candidates[0].repository!==repository)errors.push('The Bolt must have exactly one active closing candidate: this PR.');}
    if(marker.values.length===1&&marker.values[0]!==issueNumber)errors.push('The optional Bolt marker must match the authoritative GitHub closing reference.');
  }
  if(issueNumber!==null){
    const duplicateCandidates=openCandidates.filter(candidate=>candidate.number!==pr.number&&(candidate.marker?.values?.includes(issueNumber)||candidate.closing?.some(issue=>issue.number===issueNumber&&issue.repository===repository)));
    if(duplicateCandidates.length)errors.push(`Bolt #${issueNumber} has another open candidate: ${duplicateCandidates.map(candidate=>'#'+candidate.number).join(', ')}.`);
    for(const candidate of duplicateCandidates)if(candidate.marker?.values?.length&&candidate.closing?.length&&(!candidate.closing.some(issue=>issue.number===issueNumber&&issue.repository===repository)||candidate.closing.length!==1))errors.push(`Open candidate #${candidate.number} has conflicting marked and GitHub Bolt ownership.`);
  }
  if(chain.length!==4)errors.push('The native hierarchy must be Campaign -> Phase -> UOW -> Bolt.');
  if(leafChildren.length)errors.push('A Bolt must be a leaf with no sub-issues.');
  if(new Set(chain.map(issue=>issue.number)).size!==chain.length)errors.push('The native hierarchy contains a cycle.');
  if(issueNumber!==null&&chain[0]?.number!==issueNumber)errors.push('The native chain does not describe the scoped Bolt.');
  for(let index=0;index<chain.length;index++){
    const issue=chain[index];
    if(issue.state!=='open')errors.push(`Issue #${issue.number} is closed while this work is active.`);
    if(issue.pull_request)errors.push(`PR #${issue.number} cannot own an issue contract.`);
    if(JSON.stringify(issueKinds(issue))!==JSON.stringify(['type:'+kinds[index]]))errors.push(`Issue #${issue.number} must have only type:${kinds[index]}.`);
    if(issue.parentNumber!==(chain[index+1]?.number??null))errors.push(`Issue #${issue.number} has inconsistent native parentage.`);
  }
  const reviewRequests=new Set(reviewRequestIds).size;
  errors.push(...reviewErrors);
  if(reviewRequests>3)errors.push('The maximum of three Codex review requests has been exceeded.');
  return {ok:errors.length===0,errors,issue:issueNumber,head:pr.head.sha,base:pr.base.sha,reviewRequests};
}

export const isCodexReview=review=>review.user?.login==='chatgpt-codex-connector[bot]'&&review.state!=='PENDING';
export const trustedReceipt=comment=>comment.user?.login?.toLowerCase()===repository.split('/')[0].toLowerCase()||comment.author_association==='COLLABORATOR';
export function reviewRequests(prComments,issueComments,reviews=[]){
  return reviewAccounting(prComments,issueComments,reviews).ids;
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
  const result=await request('graphql',{body:{query:'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences(first:100){nodes{number repository{nameWithOwner} closedByPullRequestsReferences(first:2,includeClosedPrs:false){nodes{number repository{nameWithOwner}} pageInfo{hasNextPage}}} pageInfo{hasNextPage}}}}}',variables:{owner,name,number}}});
  const references=result.data?.repository?.pullRequest?.closingIssuesReferences;
  if(result.errors?.length||!references||!Array.isArray(references.nodes)||typeof references.pageInfo?.hasNextPage!=='boolean'||references.pageInfo.hasNextPage||references.nodes.some(issue=>!Array.isArray(issue.closedByPullRequestsReferences?.nodes)||typeof issue.closedByPullRequestsReferences.pageInfo?.hasNextPage!=='boolean'||issue.closedByPullRequestsReferences.pageInfo.hasNextPage))throw new Error('Complete GitHub closing-issue metadata is required.');
  // Two candidates already disprove single ownership; further pages must reject.
  const closing=references.nodes.map(issue=>({number:issue.number,repository:issue.repository.nameWithOwner,candidates:issue.closedByPullRequestsReferences?.nodes?.map(pr=>({number:pr.number,repository:pr.repository.nameWithOwner})),moreCandidates:issue.closedByPullRequestsReferences?.pageInfo?.hasNextPage}));
  const openCandidates=[];
  for(let page=1,cursor=null;page<=100;page++){
    const candidates=await request('graphql',{body:{query:'query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){pullRequests(first:100,states:OPEN,after:$cursor){nodes{number body closingIssuesReferences(first:100){nodes{number repository{nameWithOwner}} pageInfo{hasNextPage}}} pageInfo{hasNextPage endCursor}}}}',variables:{owner,name,cursor}}});
    const connection=candidates.data?.repository?.pullRequests;
    if(candidates.errors?.length||!connection||!Array.isArray(connection.nodes)||typeof connection.pageInfo?.hasNextPage!=='boolean'||connection.nodes.some(candidate=>!candidate.closingIssuesReferences||!Array.isArray(candidate.closingIssuesReferences.nodes)||typeof candidate.closingIssuesReferences.pageInfo?.hasNextPage!=='boolean'||candidate.closingIssuesReferences.pageInfo.hasNextPage))throw new Error('Complete open candidate metadata is required.');
    openCandidates.push(...connection.nodes.map(candidate=>({number:candidate.number,marker:boltMarkers(candidate.number===number?pr.body??'':candidate.body??''),closing:(candidate.number===number?closing:candidate.closingIssuesReferences?.nodes?.map(issue=>({number:issue.number,repository:issue.repository.nameWithOwner}))??[])})));
    if(!connection.pageInfo?.hasNextPage)break;
    if(!connection.pageInfo.endCursor)throw new Error('Complete open candidate metadata is required.');
    cursor=connection.pageInfo.endCursor;
    if(page===100)throw new Error('Open candidate pagination exceeded its documented 10,000-record budget.');
  }
  const chain=[];let leafChildren=[],issueComments=[];
  const pages=async path=>{
    const all=[];
    for(let page=1;page<=100;page++){
      const values=await request(`${route}/${path}?per_page=100&page=${page}`);all.push(...values);
      if(values.length<100)return all;
    }
    throw new Error('Metadata pagination exceeded its documented 10,000-record budget.');
  };
  const marker=boltMarkers(pr.body??''),target=pr.base.ref===featureBase?marker.values.length===1?marker.values[0]:null:closing.length===1&&closing[0].repository===repository?closing[0].number:null;
  if(target!==null){
    let issue=await request(`${route}/issues/${target}`);
    leafChildren=await request(`${route}/issues/${issue.number}/sub_issues?per_page=1`);
    issueComments=await pages(`issues/${issue.number}/comments`);
    for(let depth=0;issue&&depth<4;depth++){
      const parent=await request(`${route}/issues/${issue.number}/parent`,{optional:true});
      chain.push({...issue,parentNumber:parent?.number??null});issue=parent;
    }
  }
  const reviews=await pages(`pulls/${number}/reviews`);
  const prComments=await pages(`issues/${number}/comments`);
  const latest=await request(`${route}/pulls/${number}`);
  if(latest.head.sha!==pr.head.sha||latest.base.sha!==pr.base.sha||latest.body!==pr.body||latest.state!==pr.state||latest.draft!==pr.draft)throw new Error('The PR changed during validation. Rerun against its current head/base.');
  const accounting=reviewAccounting(prComments,issueComments,reviews,{head:pr.head.sha,base:pr.base.sha,author:pr.user?.login});
  return {pr,closing,chain,leafChildren,reviewRequestIds:accounting.ids,reviewErrors:accounting.errors,openCandidates};
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
