import {describe,it,expect,vi} from 'vitest';
import {isOwnerBoundToSession,observePostDeadlineGatewayReadiness,POST_DEADLINE_READINESS_DIAGNOSTIC_MS,sanitizeExpansionSdkReceipt} from '../scripts/verify-expansion-sdk.mjs';
import plugin,{projectTask} from './helpers/expansion-sdk-plugin.mjs';
import {GATEWAY_STARTUP_BUDGET_MS} from '../scripts/gateway-readiness-evidence.mjs';

const noUndefined=value=>{
  expect(value).not.toBeUndefined();
  if(Array.isArray(value))for(const item of value)noUndefined(item);
  else if(value&&typeof value==='object')for(const item of Object.values(value))noUndefined(item);
};
const task=(overrides={})=>({taskId:'task-1',runtime:'cli',requesterSessionKey:'agent:main:session',ownerKey:'agent:main:session',scopeKind:'session',parentFlowId:'flow-1',status:'queued',deliveryStatus:'not_applicable',notifyPolicy:'silent',task:'Synthetic task',createdAt:1,...overrides});
const flow=(overrides={})=>({flowId:'flow-1',syncMode:'managed',ownerKey:'agent:main:session',controllerId:'expansion-sdk-proof',revision:0,status:'queued',notifyPolicy:'silent',goal:'Synthetic flow',createdAt:1,updatedAt:1,...overrides});
function install(nativeTask=task()){
  let action,service;const setWaiting=vi.fn(async params=>({applied:true,flow:flow({revision:1,status:'waiting',blockedTaskId:params.blockedTaskId})}));
  const asyncFlows={createManaged:vi.fn(async()=>flow({flowId:'empty-flow'})),get:vi.fn(async id=>id==='empty-flow'?flow({flowId:id,status:'cancelled',endedAt:2}):flow()),runTask:vi.fn(async()=>({created:true,flow:flow(),task:nativeTask})),setWaiting,requestCancel:vi.fn(async params=>params.flowId==='empty-flow'?{applied:true,flow:flow({flowId:'empty-flow',revision:1,cancelRequestedAt:2})}:params.expectedRevision===0?{applied:false,code:'revision_conflict'}:{applied:true,flow:flow({revision:2,status:'waiting',cancelRequestedAt:2})})};
  plugin.register({registerService:value=>{service=value;},session:{controls:{registerSessionAction:value=>{action=value;}}},runtime:{tasks:{async:{managedFlows:{bindSession:()=>asyncFlows},runs:{bindSession:()=>({get:async()=>({id:'task-1',flowId:'flow-1',runtime:'cli',status:'queued'})})}},managedFlows:{bindSession:()=>({cancel:async()=>({found:true,cancelled:true})})}}},config:{}});
  service.start({});return {action,setWaiting};
}

describe('expansion SDK qualification receipt',()=>{
  it('requires owner binding to the authenticated session',()=>{
    expect(isOwnerBoundToSession('agent:main:session-1','agent:main:session-1')).toBe(true);
    expect(isOwnerBoundToSession('foreign:agent:main:session-1','agent:main:session-1')).toBe(false);
    expect(isOwnerBoundToSession('agent:main:session-1:foreign','agent:main:session-1')).toBe(false);
    expect(isOwnerBoundToSession('agent:main:other-session','agent:main:session-1')).toBe(false);
    expect(isOwnerBoundToSession(undefined,'agent:main:session-1')).toBe(false);
    expect(isOwnerBoundToSession('','')).toBe(false);
  });

  it('keeps a bounded post-deadline diagnostic allowance without relaxing startup',async()=>{
    let clock=GATEWAY_STARTUP_BUDGET_MS+1,probes=0;
    const readiness=await observePostDeadlineGatewayReadiness({child:{exitCode:null,signalCode:null},startedAt:0,restartOrdinal:0,now:()=>clock,probe:async()=>++probes===2,pause:async milliseconds=>{clock+=milliseconds;}});
    expect(POST_DEADLINE_READINESS_DIAGNOSTIC_MS).toBe(45_000);
    expect(GATEWAY_STARTUP_BUDGET_MS).toBe(60_000);
    expect(readiness).toMatchObject({postDeadlineAttempts:2,listenerAfterDeadline:true,listenerElapsedMs:60_101,finalProcessState:'alive'});
  });

  it('keeps the tracked receipt free of profile paths, session keys, and tokens',()=>{
    const receipt=sanitizeExpansionSdkReceipt({source:'56c9d035',verifierSha256:'verifier',fixturePluginSha256:'plugin',node:'v24.16.0',openclaw:'2026.9.5',port:21961,portSelection:'21961',token:'private',profile:'/private/profile',observations:[{label:'managed-flow-create',allowed:true,flow:{syncMode:'managed',ownerBound:true,revision:1},sessionKey:'private-session'}]});
    expect(receipt).toEqual(expect.objectContaining({noModelCalls:true,port:21961,observations:[{label:'managed-flow-create',allowed:true,flow:{syncMode:'managed',ownerBound:true,revision:1}}]}));
    expect(JSON.stringify(receipt)).not.toMatch(/private|sessionKey|token|profile/);
  });

  it('projects only documented native TaskRecord fields into a JSON-compatible action result',()=>{
    const projected=projectTask({taskId:'task-1',runtime:'cli',requesterSessionKey:'agent:main:session',ownerKey:'agent:main:session',scopeKind:'session',parentFlowId:'flow-1',status:'queued',deliveryStatus:'not_applicable',notifyPolicy:'silent',task:'Synthetic task',createdAt:1});
    expect(projected).toEqual({id:'task-1',flowId:'flow-1',sessionKey:'agent:main:session',ownerKey:'agent:main:session',runtime:'cli',status:'queued',childSessionKey:null});
    expect(JSON.parse(JSON.stringify(projected))).toEqual(projected);
  });

  it('wires native linkage identity through the registered action without undefined JSON fields',async()=>{
    const {action,setWaiting}=install(),result=await action.handler({sessionKey:'agent:main:session',agentId:'main',payload:{operation:'exercise',flowId:'flow-1'}});
    expect(result.ok).toBe(true);expect(result.result.linked).toEqual({id:'task-1',flowId:'flow-1',sessionKey:'agent:main:session',ownerKey:'agent:main:session',runtime:'cli',status:'queued',childSessionKey:null});
    expect(setWaiting).toHaveBeenCalledWith(expect.objectContaining({blockedTaskId:'task-1'}));noUndefined(result);expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('rejects a malformed native task before later managed-flow mutations',async()=>{
    const {action,setWaiting}=install(task({taskId:undefined}));await expect(action.handler({sessionKey:'agent:main:session',agentId:'main',payload:{operation:'exercise',flowId:'flow-1'}})).rejects.toThrow('taskId');expect(setWaiting).not.toHaveBeenCalled();
  });

  it('keeps empty-flow cancellation distinct from the queued-child refusal case',async()=>{
    const {action}=install(),result=await action.handler({sessionKey:'agent:main:session',agentId:'main',payload:{operation:'cancel-empty'}});
    expect(result).toMatchObject({ok:true,result:{created:{id:'empty-flow'},requested:{applied:true},cancelled:{found:true,cancelled:true},readback:{id:'empty-flow',status:'cancelled',endedAt:2}}});noUndefined(result);
  });
});
