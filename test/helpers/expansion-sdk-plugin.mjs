import {definePluginEntry} from 'openclaw/plugin-sdk/plugin-entry';

const pluginId='expansion-sdk-proof',serviceId='expansion-sdk-proof-service';
let api,serviceStarts=0,serviceStops=0;
const failure=(code,error)=>({ok:false,code,error});
const projectFlow=flow=>flow?{id:flow.flowId,ownerKey:flow.ownerKey,revision:flow.revision,status:flow.status,syncMode:flow.syncMode,controllerId:flow.controllerId,blockedTaskId:flow.blockedTaskId??null,cancelRequestedAt:flow.cancelRequestedAt??null,endedAt:flow.endedAt??null}:null;
const requiredString=(value,name)=>{if(typeof value!=='string'||!value)return (()=>{throw Error(`Native TaskRecord is missing ${name}.`);})();return value;};
export const projectTask=task=>task?{id:requiredString(task.taskId,'taskId'),flowId:task.parentFlowId??null,sessionKey:requiredString(task.requesterSessionKey,'requesterSessionKey'),ownerKey:requiredString(task.ownerKey,'ownerKey'),runtime:requiredString(task.runtime,'runtime'),status:requiredString(task.status,'status'),childSessionKey:task.childSessionKey??null}:null;
const projectTaskView=task=>task?{id:requiredString(task.id,'id'),flowId:task.flowId??null,runtime:requiredString(task.runtime,'runtime'),status:requiredString(task.status,'status')}:null;

const plugin=definePluginEntry({
  id:pluginId,name:'Expansion SDK proof fixture',description:'Disposable no-model managed-flow qualification fixture.',
  register(current){
    api=current;
    api.registerService({id:serviceId,start(){serviceStarts++;},stop(){serviceStops++;}});
    api.session.controls.registerSessionAction({
      id:'probe',description:'Disposable managed-flow qualification action.',requiredScopes:['operator.write'],
      async handler(context){
        if(!context.sessionKey)return failure('SESSION_REQUIRED','The public session action supplied no session key.');
        // The host starts the plugin-owned service. This gate is deliberately
        // plugin policy: it is evidence of service-retained admission, not an
        // assertion that the host retains an original user grant for us.
        if(serviceStarts===0)return failure('SERVICE_UNAVAILABLE','The plugin-owned service has not started.');
        const payload=context.payload&&typeof context.payload==='object'&&!Array.isArray(context.payload)?context.payload:{};
        const operation=payload.operation;
        const flows=api.runtime.tasks.async.managedFlows.bindSession({sessionKey:context.sessionKey});
        if(operation==='service')return {ok:true,result:{serviceStarted:serviceStarts>0,serviceStarts,serviceStops,sessionKey:context.sessionKey}};
        if(operation==='create'){
          const flow=await flows.createManaged({controllerId:pluginId,goal:'Disposable SDK05 managed-flow proof',status:'queued',stateJson:{fixture:true,noModelCalls:true}});
          return {ok:true,result:{flow:projectFlow(flow)}};
        }
        if(operation==='cancel-empty'){
          const flow=await flows.createManaged({controllerId:pluginId,goal:'Disposable SDK05 empty-flow cancellation proof',status:'queued',stateJson:{fixture:true,noModelCalls:true}});
          const requested=await flows.requestCancel({flowId:flow.flowId,expectedRevision:flow.revision,cancelRequestedAt:2});
          if(!requested.applied)return failure('EMPTY_CANCEL_REQUEST_NOT_APPLIED',requested.code);
          const cancelled=await api.runtime.tasks.managedFlows.bindSession({sessionKey:context.sessionKey}).cancel({flowId:flow.flowId,cfg:api.config});
          return {ok:true,result:{created:projectFlow(flow),requested:{applied:requested.applied,flow:projectFlow(requested.flow)},cancelled:{found:cancelled.found,cancelled:cancelled.cancelled,reason:cancelled.reason??null},readback:projectFlow(await flows.get(flow.flowId))}};
        }
        const flowId=typeof payload.flowId==='string'?payload.flowId:'';
        if(!flowId)return failure('FLOW_REQUIRED','A managed-flow identifier is required.');
        if(operation==='read')return {ok:true,result:{flow:projectFlow(await flows.get(flowId))}};
        if(operation==='exercise'){
          const original=await flows.get(flowId);if(!original)return failure('FLOW_NOT_FOUND','The session-bound managed flow was not found.');
          const linked=await flows.runTask({flowId,runtime:'cli',sourceId:pluginId,agentId:context.agentId,task:'Disposable no-model SDK05 linkage record',label:'SDK05 no-model linkage',status:'queued'});
          if(!linked.created)return failure('LINK_NOT_CREATED',linked.reason);
          const linkedTask=projectTask(linked.task);
          const waiting=await flows.setWaiting({flowId,expectedRevision:original.revision,currentStep:'proof-wait',stateJson:{fixture:true,noModelCalls:true},blockedTaskId:linkedTask.id,blockedSummary:'Disposable linkage proof'});
          if(!waiting.applied)return failure('WAITING_NOT_APPLIED',waiting.code);
          const stale=await flows.requestCancel({flowId,expectedRevision:original.revision,cancelRequestedAt:1});
          const requested=await flows.requestCancel({flowId,expectedRevision:waiting.flow.revision,cancelRequestedAt:2});
          if(!requested.applied)return failure('CANCEL_REQUEST_NOT_APPLIED',requested.code);
          const cancelled=await api.runtime.tasks.managedFlows.bindSession({sessionKey:context.sessionKey}).cancel({flowId,cfg:api.config});
          const activeTask=await api.runtime.tasks.async.runs.bindSession({sessionKey:context.sessionKey,agentId:context.agentId}).get(linked.task.taskId);
          return {ok:true,result:{original:projectFlow(original),linked:linkedTask,waiting:{applied:waiting.applied,flow:projectFlow(waiting.flow)},stale:{applied:stale.applied,code:stale.applied?null:stale.code},requested:{applied:requested.applied,flow:projectFlow(requested.flow)},cancelled:{found:cancelled.found,cancelled:cancelled.cancelled,reason:cancelled.reason??null},activeTask:projectTaskView(activeTask),readback:projectFlow(await flows.get(flowId))}};
        }
        return failure('UNKNOWN_OPERATION','The disposable fixture does not implement that operation.');
      },
    });
  },
});
export default plugin;
