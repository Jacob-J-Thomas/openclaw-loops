import {describe,it,expect} from 'vitest';
import {repository,validateContract,reviewRequests,collectContract} from '../scripts/verify-aidlc.mjs';

const head='a'.repeat(40),base='b'.repeat(40);
function fixture(){return {pr:{number:118,state:'open',draft:false,head:{sha:head},base:{sha:base,ref:'main',repo:{full_name:repository}}},closing:[{number:42,repository}],chain:[
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
    const ids=reviewRequests([{id:12,user:{type:'User'},body:'@codex review\nRound 2/3.'},{id:88,user:{type:'Bot'},body:'@codex review is how to request review.'}],
      [{body:'<!-- loops-review-request:11 -->'},{body:'<!-- loops-review-request:12 -->'},{body:'<!-- loops-review-request:12 -->'}]);
    expect(ids.sort()).toEqual(['11','12']);const value=fixture();value.reviewRequestIds=ids;expect(validateContract(value).reviewRequests).toBe(2);
  });
  it('uses authoritative closing references and native parents, paginates comments and rejects a moving head',async()=>{
    const value=fixture(),seen=[];let moved=false,reads=0;
    const request=async(path)=>{
      seen.push(path);
      if(path==='graphql')return {data:{repository:{pullRequest:{closingIssuesReferences:{nodes:[{number:42,repository:{nameWithOwner:repository}}],pageInfo:{hasNextPage:false}}}}}};
      if(path.endsWith('/pulls/118'))return {...value.pr,head:{sha:moved&&reads++?'c'.repeat(40):head}};
      if(path.endsWith('/issues/42'))return value.chain[0];
      if(path.endsWith('/sub_issues?per_page=1'))return [];
      const parent=/issues\/(\d+)\/parent$/.exec(path);
      if(parent){const index=value.chain.findIndex(i=>i.number===Number(parent[1]));return value.chain[index+1]??null;}
      if(path.endsWith('/issues/118/comments?per_page=100&page=1'))return Array.from({length:100},(_,id)=>({id,user:{type:'Bot'},body:'unrelated'}));
      if(path.includes('/comments?'))return [];
      throw new Error('Unexpected request: '+path);
    };
    expect(validateContract(await collectContract(118,request)).ok).toBe(true);expect(seen).toContain(`repos/${repository}/issues/118/comments?per_page=100&page=2`);
    moved=true;await expect(collectContract(118,request)).rejects.toThrow('changed during validation');
  });
  it('does not accept missing GraphQL evidence as a zero-issue success',async()=>{
    const value=fixture();await expect(collectContract(118,async path=>path==='graphql'?{errors:[{message:'denied'}]}:value.pr)).rejects.toThrow('Complete GitHub');
  });
});
