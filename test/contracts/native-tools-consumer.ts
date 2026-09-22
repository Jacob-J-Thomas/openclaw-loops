import {createOpenClawCodingTools,type AnyAgentTool} from 'openclaw/plugin-sdk/agent-harness';
import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/core';

type Equal<A,B>=[A] extends [B]?[B] extends [A]?true:false:false;
type Assert<T extends true>=T;
type FactoryOptions=Exclude<Parameters<typeof createOpenClawCodingTools>[0],undefined>;
type RuntimeAgent=OpenClawPluginApi['runtime']['agent'];
type Session=RuntimeAgent['session'];
type Admission=Session['runWithWorkAdmission'];
type AdmissionParams=Parameters<Admission>[0];
type WorkspaceAuthority=Awaited<ReturnType<OpenClawPluginApi['runtime']['sandbox']['prepareWorkspaceAuthority']>>;

// Compile-only external-plugin consumer. Runtime evidence belongs to the
// disposable Gateway verifier; this file pins its named public contracts.
export type FactoryReturnsNativeTools=Assert<Equal<ReturnType<typeof createOpenClawCodingTools>,AnyAgentTool[]>>;
export type FactoryHasCurrentSession=Assert<FactoryOptions extends {sessionKey?:string;runSessionKey?:string;config?:OpenClawPluginApi['config']}?true:false>;
export type AdmissionBindsStoreAndSession=Assert<AdmissionParams extends {storePath:string;sessionKey:string}?true:false>;
export type WorkspaceResolverHasHostConfig=Assert<Parameters<RuntimeAgent['resolveAgentWorkspaceDir']> extends [OpenClawPluginApi['config'],string,...unknown[]]?true:false>;
export type AuthorityReportsOnlyConfinement=Assert<WorkspaceAuthority extends {sandboxed:boolean;workspaceAccess:'none'|'ro'|'rw'}?true:false>;

export function buildCurrentSessionSurface(api:OpenClawPluginApi,sessionKey:string,agentId:string){
  const config=api.config,workspaceDir=api.runtime.agent.resolveAgentWorkspaceDir(config,agentId);
  return createOpenClawCodingTools({config,agentId,sessionKey,runSessionKey:sessionKey,workspaceDir,cwd:workspaceDir,sessionConfigSource:'runtime'});
}

export async function admitCurrentSession<T>(api:OpenClawPluginApi,sessionKey:string,agentId:string,run:(signal:AbortSignal)=>Promise<T>){
  const storePath=api.runtime.agent.session.resolveStorePath(api.config.session?.store,{agentId});
  return await api.runtime.agent.session.runWithWorkAdmission({storePath,sessionKey},run);
}
