import {describe,it,expect} from 'vitest';
import {repository,validateContract,reviewRequests,collectContract} from '../scripts/verify-aidlc.mjs';
import {mergeCandidate,requiredChecks,validateChecks} from '../scripts/merge-aidlc.mjs';

const head='a'.repeat(40),base='b'.repeat(40);
function fixture(){return {pr:{number:118,state:'open',draft:false,head:{sha:head},base:{sha:base,ref:'main',repo:{full_name:repository}}},closing:[{number:42,repository,candidates:[{number:118,repository}],moreCandidates:false}],chain:[
  {number:42,state:'open',labels:[{name:'type:bolt'},{name:'status:in-progress'}],parentNumber:9},
  {number:9,state:'open',labels:[{name:'type:uow'}],parentNumber:3},
  {number:3,state:'open',labels:[{name:'type:phase'}],parentNumber:2},
  {number:2,state:'open',labels:[{name:'type:campaign'}],parentNumber:null},
],leafChildren:[],reviewRequestIds:[]};}

describe('Loops AIDLC contract',()=>{
  it('accepts a single leaf PR to main without treating a contract check as review approval',()=>{
    expect(validateContract(fixture())).toEqual({ok:true,errors:[],issue:42,head,base,reviewRequests:0});
  });
  it.each([
    ['a draft',s=>{s.pr.draft=true;}],
    ['a closed PR',s=>{s.pr.state='closed';}],
    ['a stacked PR',s=>{s.pr.base.ref='codex/parent';}],
    ['another target repository',s=>{s.pr.base.repo.full_name='different/repository';}],
    ['a missing head',s=>{s.pr.head.sha='unknown';}],
    ['no closing issue',s=>{s.closing=[];}],
    ['multiple closing issues',s=>{s.closing.push({number:43,repository});}],
    ['a foreign closing issue',s=>{s.closing[0].repository='different/repository';}],
    ['a competing candidate',s=>{s.closing[0].candidates.push({number:119,repository});}],
    ['missing candidate metadata',s=>{delete s.closing[0].candidates;}],
    ['additional candidate pages',s=>{s.closing[0].moreCandidates=true;}],
    ['a foreign candidate with the same number',s=>{s.closing[0].candidates[0].repository='different/repository';}],
    ['a non-leaf Bolt',s=>{s.leafChildren=[{number:43}];}],
    ['a closed parent',s=>{s.chain[1].state='closed';}],
    ['a PR as owner',s=>{s.chain[1].pull_request={};}],
    ['an ambiguous type',s=>{s.chain[0].labels.push({name:'type:finding'});}],
    ['a non-Bolt closure',s=>{s.chain[0].labels=[{name:'type:uow'}];}],
    ['a missing parent',s=>{s.chain.pop();}],
    ['a non-root Campaign',s=>{s.chain[3].parentNumber=99;}],
    ['an inconsistent edge',s=>{s.chain[0].parentNumber=88;}],
    ['a mismatched closing target',s=>{s.closing[0].number=43;}],
    ['a fourth review request',s=>{s.reviewRequestIds=['1','2','3','4'];}],
  ])('rejects %s',(_name,mutate)=>{const value=fixture();mutate(value);expect(validateContract(value)).toMatchObject({ok:false,errors:expect.arrayContaining([expect.any(String)])});});
  it('retains mirrored review requests after deletion and does not count bot help or duplicate receipts',()=>{
    const ids=reviewRequests([{...authored('@codex review\nRound 2/3.'),id:12},{id:88,user:{type:'Bot'},body:'@codex review is how to request review.'}],
      [authored('<!-- loops-review-request:11 -->'),authored('<!-- loops-review-request:12 -->'),authored('<!-- loops-review-request:12 -->')]);
    expect(ids.sort()).toEqual(['11','12']);const value=fixture();value.reviewRequestIds=ids;expect(validateContract(value).reviewRequests).toBe(2);
  });
  it('uses authoritative closing references and native parents, paginates comments and rejects a moving head',async()=>{
    const value=fixture(),seen=[];let moved=false,reads=0;
    const request=async(path)=>{
      seen.push(path);
      if(path==='graphql')return {data:{repository:{pullRequest:{closingIssuesReferences:{nodes:[{number:42,repository:{nameWithOwner:repository},closedByPullRequestsReferences:{nodes:[{number:118,repository:{nameWithOwner:repository}}],pageInfo:{hasNextPage:false}}}],pageInfo:{hasNextPage:false}}}}}};
      if(path.endsWith('/pulls/118'))return {...value.pr,head:{sha:moved&&reads++?'c'.repeat(40):head}};
      if(path.endsWith('/issues/42'))return value.chain[0];
      if(path.endsWith('/sub_issues?per_page=1'))return [];
      const parent=/issues\/(\d+)\/parent$/.exec(path);
      if(parent){const index=value.chain.findIndex(i=>i.number===Number(parent[1]));return value.chain[index+1]??null;}
      if(path.endsWith('/issues/118/comments?per_page=100&page=1'))return Array.from({length:100},(_,id)=>({id,user:{type:'Bot'},body:'unrelated'}));
      if(path.includes('/comments?'))return [];
      if(path.includes('/reviews?'))return [];
      throw new Error('Unexpected request: '+path);
    };
    expect(validateContract(await collectContract(118,request)).ok).toBe(true);expect(seen).toContain(`repos/${repository}/issues/118/comments?per_page=100&page=2`);
    moved=true;await expect(collectContract(118,request)).rejects.toThrow('changed during validation');
  });
  it('does not accept missing GraphQL evidence as a zero-issue success',async()=>{
    const value=fixture();await expect(collectContract(118,async path=>path==='graphql'?{errors:[{message:'denied'}]}:value.pr)).rejects.toThrow('Complete GitHub');
  });
});

const review=(id,commit_id=head)=>({id,commit_id,state:'COMMENTED',user:{login:'chatgpt-codex-connector[bot]'}});
const authored=body=>({body,user:{login:'Jacob-J-Thomas',type:'User'},author_association:'OWNER'});
const requestComment=id=>({...authored('@codex review'),id});
const automatic={id:7,user:{login:'chatgpt-codex-connector[bot]',type:'Bot'},body:'<!-- codex-pull-request-review-summary -->\n| 📝 **Code Review** | Running | `aaaaaaa` | PR opened |'};
describe('automatic and requested review accounting',()=>{
  it('counts a formal automatic review without any manual marker',()=>{expect(reviewRequests([],[],[review(10)])).toEqual(['review:10']);});
  it('counts automatic summaries separately until a formal result is explicitly attributed',()=>{
    expect(reviewRequests([automatic],[],[])).toEqual(['summary:7']);
    expect(reviewRequests([automatic],[],[review(10)])).toHaveLength(2);
    expect(reviewRequests([automatic],[authored('<!-- loops-review-auto-result:7:10 -->')],[review(10)])).toEqual(['summary:7']);
    expect(reviewRequests([automatic,requestComment(20)],[authored('<!-- loops-review-auto-result:7:10 -->')],[review(10)])).toHaveLength(2);
  });
  it('keeps a mirrored clean automatic round after its summary changes',()=>{
    expect(reviewRequests([requestComment(20)],[authored('<!-- loops-review-auto:summary:7 -->')],[])).toHaveLength(2);
  });
  it('reconciles one manual result only with explicit one-to-one evidence',()=>{
    const receipts=[authored('<!-- loops-review-request:20 -->\n<!-- loops-review-result:20:30 -->\n<!-- loops-review-auto:review:10 -->')];
    expect(reviewRequests([requestComment(20)],receipts,[review(10),review(30)])).toEqual(['20','review:10']);
    expect(reviewRequests([],receipts,[review(10),review(30)])).toHaveLength(2);
    expect(reviewRequests([requestComment(20)],[...receipts,authored('<!-- loops-review-result:20:40 -->')],[review(10),review(30),review(40)])).toHaveLength(4);
  });
  it('does not use a result to hide two requests or accept an absent result',()=>{
    expect(reviewRequests([requestComment(20),requestComment(21)],[authored('<!-- loops-review-result:20:30 -->\n<!-- loops-review-result:21:30 -->')],[review(30)])).toHaveLength(3);
    expect(reviewRequests([requestComment(20)],[authored('<!-- loops-review-result:20:99 -->')],[review(30)])).toHaveLength(2);
  });
  it('rejects four observed runs while ignoring other reviewers and pending submissions',()=>{
    const value=fixture();value.reviewRequestIds=reviewRequests([requestComment(20),requestComment(21),requestComment(22)],[],[review(10)]);
    expect(validateContract(value).ok).toBe(false);
    expect(reviewRequests([],[],[{...review(1),state:'PENDING'},{...review(2),user:{login:'someone-else'}}])).toEqual([]);
  });
  it('does not collapse a clean automatic round into a later manual result on the same commit',()=>{
    const receipts=[authored('<!-- loops-review-request:20 -->\n<!-- loops-review-result:20:30 -->')];
    expect(reviewRequests([automatic,requestComment(20)],receipts,[review(30)])).toEqual(['20','summary:7']);
    const conflict=[...receipts,authored('<!-- loops-review-auto-result:7:30 -->')];
    expect(reviewRequests([automatic,requestComment(20)],conflict,[review(30)])).toHaveLength(3);
  });
  it('ignores unauthenticated markers and requests, including forged pairings',()=>{
    const stranger={user:{login:'stranger',type:'User'},author_association:'NONE'};
    const forged=[{...stranger,body:'<!-- loops-review-request:1 --><!-- loops-review-request:2 --><!-- loops-review-request:3 --><!-- loops-review-request:4 -->'}, {...stranger,body:'<!-- loops-review-result:20:30 -->'}];
    expect(reviewRequests([{...stranger,id:1,body:'@codex review'}],forged,[])).toEqual([]);
    expect(reviewRequests([requestComment(20)],forged,[review(30)])).toHaveLength(2);
    expect(reviewRequests([],[{...authored('<!-- loops-review-request:1 -->'),user:{login:'maintainer'},author_association:'COLLABORATOR'}],[])).toEqual(['1']);
  });
});

const passingChecks=()=>({total_count:requiredChecks.length,check_runs:requiredChecks.map((name,index)=>({id:index+1,name,head_sha:head,status:'completed',conclusion:'success'}))});
describe('required current-metadata merge mechanism',()=>{
  it('rechecks the contract after CI inspection and merges only the reviewed head',async()=>{
    const calls=[],value=fixture();value.reviewRequestIds=['review:1'];
    const result=await mergeCandidate(118,{head,base},{collect:async()=>{calls.push('contract');return value;},request:async path=>{expect(path).toContain(head);calls.push('checks');return passingChecks();},merge:async(number,sha)=>{calls.push('merge');expect([number,sha]).toEqual([118,head]);return {merged:true,sha:'c'.repeat(40)};}});
    expect(calls).toEqual(['contract','checks','contract','merge']);expect(result.checks).toHaveLength(5);
  });
  it.each(['closed-parent','fourth-review','competing-candidate','changed-head','changed-base','no-review','failed-check'])('does not merge after %s',async mode=>{
    const value=fixture();value.reviewRequestIds=['review:1'];let reads=0,merged=false;
    const run=()=>mergeCandidate(118,{head,base},{collect:async()=>{
      if(++reads===2){if(mode==='closed-parent')value.chain[1].state='closed';if(mode==='fourth-review')value.reviewRequestIds=['1','2','3','4'];if(mode==='competing-candidate')value.closing[0].candidates.push({number:119,repository});if(mode==='changed-head')value.pr.head.sha='c'.repeat(40);if(mode==='changed-base')value.pr.base.sha='c'.repeat(40);if(mode==='no-review')value.reviewRequestIds=[];}
      return value;
    },request:async()=>{const checks=passingChecks();if(mode==='failed-check')checks.check_runs[0].conclusion='failure';return checks;},merge:async()=>{merged=true;return {merged:true};}});
    await expect(run()).rejects.toThrow();expect(merged).toBe(false);
  });
  it('does not accept an older pass, another head, missing checks or incomplete pagination',()=>{
    const older=passingChecks();older.check_runs.push({...older.check_runs[0],id:100,status:'queued',conclusion:null});older.total_count++;expect(()=>validateChecks(older,head)).toThrow('not successful');
    const foreign=passingChecks();foreign.check_runs[0].head_sha='c'.repeat(40);expect(()=>validateChecks(foreign,head)).toThrow();
    expect(()=>validateChecks({total_count:0,check_runs:[]},head)).toThrow();expect(()=>validateChecks({...passingChecks(),total_count:101},head)).toThrow('Complete');
  });
});
