import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/plugin-entry';
type Runtime=OpenClawPluginApi['runtime'];
type Run=Runtime['agent']['runEmbeddedAgent'];
type Params=Parameters<Run>[0];
type Result=Awaited<ReturnType<Run>>;
type Assert<T extends true>=T;
export type NoForgedAdmission=Assert<'admittedRunContext' extends keyof Params?false:true>;
export type NoPreparedAdmission=Assert<'preparedRunAdmission' extends keyof Params?false:true>;
export type SupportedIdentity=Assert<Params extends {sessionId:string;workspaceDir:string;prompt:string;timeoutMs:number;runId:string}?true:false>;
export type CurrentSessionResult=Assert<NonNullable<Result['meta']['agentMeta']> extends {sessionId:string;provider:string;model:string}?true:false>;
export function runNativeCurrentAgent(api:OpenClawPluginApi,owner:{agentId:string;sessionId:string;sessionKey:string;storePath:string},workspaceDir:string,runId:string,provider:string,model:string,thinking:string,prompt:string){
  const config=structuredClone(api.runtime.config.current()) as OpenClawPluginApi['config'];
  return api.runtime.agent.session.runWithWorkAdmission({storePath:owner.storePath,sessionKey:owner.sessionKey},signal=>api.runtime.agent.runEmbeddedAgent({
    agentId:owner.agentId,sessionId:owner.sessionId,sessionKey:owner.sessionKey,sessionTarget:owner,workspaceDir,cwd:workspaceDir,config,sessionPersistence:'durable',requireWorkspaceOnly:true,
    runId,provider,model,thinkLevel:api.runtime.agent.normalizeThinkingLevel(thinking),prompt,extraSystemPrompt:'Fixture auditor',toolsAllow:['read','write'],disableMessageTool:true,
    streamParams:{maxTokens:1024},contextTokenBudget:32768,timeoutMs:120000,abortSignal:signal,onExecutionPhase:event=>{const phase:string=event.phase;void phase;},onAgentToolResult:event=>{const name:string=event.toolName;const failed:boolean=event.isError;void name;void failed;},
  }));
}
