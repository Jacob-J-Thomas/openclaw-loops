import {createOpenClawCodingTools} from 'openclaw/plugin-sdk/agent-harness';
import {definePluginEntry} from 'openclaw/plugin-sdk/plugin-entry';

const pluginId='native-tools-proof',selectedNames=new Set(['read','write','get_goal','create_goal','update_goal']);
let api;
const errorFact=error=>({name:error instanceof Error?error.name:'UnknownError',code:typeof error?.code==='string'?error.code:null,message:error instanceof Error?error.message:'Unknown native failure.'});
// Session-action handlers use the host's outer success envelope. Fixture-level
// denials stay in the result payload so callers can retain their raw cause;
// Gateway scope failures happen before this handler and remain host errors.
const failure=(code,stage,error)=>({ok:true,result:{ok:false,code,stage,...error?{observed:errorFact(error)}:{}}});
const nonEmpty=value=>typeof value==='string'&&value.trim()?value.trim():undefined;
const text=value=>Array.isArray(value?.content)?value.content.filter(item=>item?.type==='text'&&typeof item.text==='string').map(item=>item.text).join('\n'):'';
const result=value=>({text:text(value),status:typeof value?.details?.status==='string'?value.details.status:null,kind:typeof value?.details?.kind==='string'?value.details.kind:null});
const toolError=error=>({rejected:true,message:error instanceof Error?error.message:'Native tool rejected the request.'});
export const projectGoalResult=value=>{
  const details=value?.details,goal=details&&typeof details==='object'&&details.goal&&typeof details.goal==='object'?details.goal:null;
  return {operation:typeof details?.status==='string'?details.status:null,goal:goal?{id:typeof goal.id==='string'?goal.id:null,objective:typeof goal.objective==='string'?goal.objective:null,status:typeof goal.status==='string'?goal.status:null,tokenBudget:Number.isSafeInteger(goal.tokenBudget)?goal.tokenBudget:null}:null};
};

export function selectNativeTool(tools,name){
  if(!selectedNames.has(name))return {ok:false,code:'TOOL_NOT_SELECTED'};
  const tool=tools.find(candidate=>candidate.name===name);
  return tool?{ok:true,tool}:{ok:false,code:'TOOL_UNAVAILABLE'};
}

async function invoke(context,run){
  const sessionKey=nonEmpty(context.sessionKey),agentId=nonEmpty(context.agentId);
  if(!sessionKey||!agentId)return failure('SESSION_IDENTITY_REQUIRED','session-identity');
  let config,workspaceDir,storePath;
  try{
    config=api.runtime.config.current();workspaceDir=api.runtime.agent.resolveAgentWorkspaceDir(config,agentId);storePath=api.runtime.agent.session.resolveStorePath(config.session?.store,{agentId});
  }catch(error){return failure('CURRENT_SESSION_RESOLUTION_FAILED','current-config-workspace-store',error);}
  try{return await api.runtime.agent.session.runWithWorkAdmission({storePath,sessionKey},async signal=>{
    let session;try{session=api.runtime.agent.session.getSessionEntry({storePath,sessionKey,agentId,readConsistency:'latest'});}catch(error){return failure('CURRENT_SESSION_READ_FAILED','session-read',error);}
    if(!session)return failure('SESSION_UNAVAILABLE','session-read');
    let authority;try{authority=await api.runtime.sandbox.prepareWorkspaceAuthority({config,agentId,sessionKey,workspaceDir,requiredToolNames:['read','write']});}catch(error){return failure('WORKSPACE_AUTHORITY_FAILED','workspace-authority',error);}
    let tools;try{tools=createOpenClawCodingTools({config,agentId,sessionKey,runSessionKey:sessionKey,workspaceDir,cwd:workspaceDir,abortSignal:signal,sessionConfigSource:'runtime'});}catch(error){return failure('NATIVE_TOOL_FACTORY_FAILED','tool-factory',error);}
    try{return await run({tools,authority,signal,workspaceDir});}catch(error){return failure('NATIVE_TOOL_OPERATION_FAILED','tool-operation',error);}
  });}catch(error){return failure('CURRENT_SESSION_OPERATION_FAILED','work-admission',error);}
}

const plugin=definePluginEntry({
  id:pluginId,name:'Native tools proof fixture',description:'Disposable no-model native tool and goal qualification fixture.',
  register(current){
    api=current;
    api.session.controls.registerSessionAction({
      id:'probe',description:'Disposable native tool qualification action.',requiredScopes:['operator.write'],
      async handler(context){
        const payload=context.payload&&typeof context.payload==='object'&&!Array.isArray(context.payload)?context.payload:{};
        const operation=payload.operation;
        return await invoke(context,async({tools,authority,signal})=>{
          if(operation==='inventory')return {ok:true,result:{selected:[...selectedNames].map(name=>({name,available:tools.some(tool=>tool.name===name)})),workspaceAccess:authority.workspaceAccess,sandboxed:authority.sandboxed,confinementError:authority.confinementError??null}};
          if(operation==='select'){
            const selected=selectNativeTool(tools,typeof payload.name==='string'?payload.name:'');
            return selected.ok?{ok:true,result:{name:selected.tool.name,selected:true}}:{ok:true,result:{name:typeof payload.name==='string'?payload.name:null,selected:false,code:selected.code}};
          }
          if(operation==='read'||operation==='write'){
            const name=operation,selected=selectNativeTool(tools,name);if(!selected.ok)return {ok:true,result:{tool:name,outcome:{rejected:true,code:selected.code}}};
            const args=operation==='read'?{path:typeof payload.path==='string'?payload.path:'seed.txt'}:{path:typeof payload.path==='string'?payload.path:'written.txt',content:typeof payload.content==='string'?payload.content:'native-tools-write'};
            try{return {ok:true,result:{tool:name,outcome:result(await selected.tool.execute(`native-tools-${name}`,args,signal))}};}catch(error){return {ok:true,result:{tool:name,outcome:toolError(error)}};}
          }
          if(operation==='goal'){
            const get=selectNativeTool(tools,'get_goal'),create=selectNativeTool(tools,'create_goal'),update=selectNativeTool(tools,'update_goal');
            if(!get.ok||!create.ok||!update.ok)return {ok:true,result:{goalToolsAvailable:false,code:'GOAL_TOOLS_UNAVAILABLE'}};
            const objective=typeof payload.objective==='string'?payload.objective:'Native tool qualification objective';
            const created=await create.tool.execute('native-tools-goal-create',{objective,token_budget:17},signal);
            let duplicate;try{duplicate=await create.tool.execute('native-tools-goal-duplicate',{objective,token_budget:17},signal);}catch(error){duplicate=toolError(error);}
            const before=await get.tool.execute('native-tools-goal-get-before',{},signal);
            const completed=await update.tool.execute('native-tools-goal-complete',{status:'complete',note:'Qualification completed'},signal);
            const after=await get.tool.execute('native-tools-goal-get-after',{},signal);
            return {ok:true,result:{goalToolsAvailable:true,created:projectGoalResult(created),duplicate:duplicate?.rejected?duplicate:projectGoalResult(duplicate),before:projectGoalResult(before),completed:projectGoalResult(completed),after:projectGoalResult(after)}};
          }
          if(operation==='goal-read'){
            const get=selectNativeTool(tools,'get_goal');if(!get.ok)return {ok:true,result:{goal:null,code:get.code}};
            return {ok:true,result:{goal:projectGoalResult(await get.tool.execute('native-tools-goal-restart-read',{},signal))}};
          }
          return failure('UNKNOWN_OPERATION','operation');
        });
      },
    });
  },
});
export default plugin;
