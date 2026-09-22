import {describe,expect,it} from 'vitest';
import {sanitizeNativeToolsReceipt} from '../scripts/verify-native-tools.mjs';
import {projectGoalResult,selectNativeTool} from './helpers/native-tools-plugin.mjs';

const noUndefined=value=>{expect(value).not.toBeUndefined();if(Array.isArray(value))for(const item of value)noUndefined(item);else if(value&&typeof value==='object')for(const item of Object.values(value))noUndefined(item);};

describe('native tools SDK qualification harness',()=>{
  it('keeps the published receipt free of private profile, session, and token data',()=>{
    const receipt=sanitizeNativeToolsReceipt({source:'848f880',verifierSha256:'verifier',fixturePluginSha256:'fixture',node:'v24.16.0',openclaw:'2026.9.5',port:21971,portSelection:'21971',profile:'/private/profile',token:'private-token',observations:[{label:'current-session-factory-inventory',allowed:true,tools:['read','write'],workspaceAccess:'rw',sandboxed:false,sessionKey:'private-session',observed:{message:'private native failure'}}],cleanup:{clientsStopped:true,clientCount:2,gateway:{exited:true,signal:'SIGTERM'}}});
    expect(receipt).toEqual(expect.objectContaining({noModelCalls:true,observations:[{label:'current-session-factory-inventory',allowed:true,tools:['read','write'],workspaceAccess:'rw',sandboxed:false}]}));
    expect(JSON.stringify(receipt)).not.toMatch(/private|sessionKey|token|profile/);
  });

  it('selects only the declared no-model tool subset and never turns an absent name into authority',()=>{
    const tools=[{name:'read',execute:async()=>({})},{name:'write',execute:async()=>({})},{name:'exec',execute:async()=>({})}];
    expect(selectNativeTool(tools,'read')).toMatchObject({ok:true,tool:{name:'read'}});
    expect(selectNativeTool(tools,'exec')).toEqual({ok:false,code:'TOOL_NOT_SELECTED'});
    expect(selectNativeTool(tools,'browser')).toEqual({ok:false,code:'TOOL_NOT_SELECTED'});
  });

  it('makes only JSON-compatible action projections from real-tool result fields',()=>{
    const result={ok:true,result:{tool:'read',outcome:{text:'native-tools-seed',status:null,kind:'text'}}};
    noUndefined(result);expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('projects native goal details structurally instead of matching objective text',()=>{
    const projected=projectGoalResult({details:{status:'found',goal:{id:'goal-1',objective:'Native tool state qualification',status:'complete',tokenBudget:17}}});
    expect(projected).toEqual({operation:'found',goal:{id:'goal-1',objective:'Native tool state qualification',status:'complete',tokenBudget:17}});
    expect(projectGoalResult({details:{status:'missing'}})).toEqual({operation:'missing',goal:null});
  });

  it('labels an unavailable current-session read as a fixture guard, not a host admission denial',()=>{
    const receipt=sanitizeNativeToolsReceipt({source:'848f880',verifierSha256:'verifier',fixturePluginSha256:'fixture',node:'v24.16.0',openclaw:'2026.9.5',port:21971,portSelection:'21971',observations:[{label:'invalid-session-current-read-guard',allowed:false,hostDenied:false,code:'SESSION_UNAVAILABLE'}],cleanup:{clientsStopped:true,clientCount:1,gateway:{exited:true,signal:'SIGTERM'}}});
    expect(receipt.observations).toEqual([{label:'invalid-session-current-read-guard',allowed:false,hostDenied:false,code:'SESSION_UNAVAILABLE'}]);
    expect(receipt.limits[1]).toMatch(/host admitted/i);
  });
});
