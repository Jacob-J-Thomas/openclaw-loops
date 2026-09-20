import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/core';

// Compile-only external-plugin consumer. These requests are never dispatched.
// npm run typecheck checks this file against the exact declared peer version.
type Complete = OpenClawPluginApi['runtime']['llm']['complete'];
type Request = Parameters<Complete>[0];
type Result = Awaited<ReturnType<Complete>>;
type IsolatedRequest = Extract<Request,{execution:{mode:'isolated-agent-runtime'}}>;
type DirectRequest = Exclude<Request,IsolatedRequest>;
type ResolveModelRuntimePolicy = OpenClawPluginApi['runtime']['modelConfig']['resolveModelRuntimePolicy'];
type RuntimePolicyRequest = Parameters<ResolveModelRuntimePolicy>[0];
type RuntimePolicyResult = ReturnType<ResolveModelRuntimePolicy>;
type Equal<A,B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type Assert<T extends true> = T;
type SamplingKey = 'temperature'|'topP'|'topK'|'minP'|'typicalP'|
  'frequencyPenalty'|'presencePenalty'|'repetitionPenalty'|'seed'|'stop'|'maxTokens';

// A peer upgrade changing these contracts requires renewed qualification.
export type AvailableSampling = Assert<Equal<Extract<keyof Request,SamplingKey>,'temperature'|'maxTokens'>>;
export type CompletionAttribution = Assert<Equal<keyof Result,'text'|'provider'|'model'|'responseModel'|'stopReason'|'agentId'|'usage'|'execution'|'audit'>>;
export type CompletionAdditions = Assert<Equal<Pick<Result,'responseModel'|'stopReason'>,{responseModel?:string;stopReason?:'stop'|'length'|'toolUse'|'error'|'aborted'}>>;
export type DirectOnlyControls = Assert<Equal<Extract<keyof DirectRequest,'responseFormat'|'requiredAuthMode'>,'responseFormat'|'requiredAuthMode'>>;
export type IsolatedHasNoDirectControls = Assert<Equal<Extract<keyof IsolatedRequest,'responseFormat'|'requiredAuthMode'>,never>>;
export type LlmHasNoCapabilitiesMember = Assert<Equal<Extract<keyof OpenClawPluginApi['runtime']['llm'],'capabilities'>,never>>;
export type RuntimePolicyRequestKeys = Assert<Equal<keyof RuntimePolicyRequest,'config'|'provider'|'modelId'|'sessionKey'|'agentId'|'agentScope'>>;
export type RuntimePolicyRequestShape = Assert<RuntimePolicyRequest extends {config?:unknown;provider?:string;modelId?:string;sessionKey?:string} ? true : false>;
export type RuntimePolicyResultKeys = Assert<Equal<keyof RuntimePolicyResult,'policy'|'source'|'matchedProvider'|'forcedByEnvironment'>>;
export type RuntimePolicyResultShape = Assert<RuntimePolicyResult extends {policy?:unknown;source?:'model'|'provider';matchedProvider?:string;forcedByEnvironment?:true} ? true : false>;

export const inheritedRequest = {
  messages:[{role:'user',content:'Compile-only SDK01 consumer'}],
  execution:{mode:'isolated-agent-runtime'},
} satisfies Request;

export const overrideRequest = {
  messages:[{role:'user',content:'Compile-only SDK01 consumer'}],
  execution:{mode:'isolated-agent-runtime'},
  model:'example/model',temperature:0,maxTokens:96,reasoning:'low',
} satisfies Request;

// These are direct-provider controls only. Loops continues to use isolated mode.
export const directOnlyContract = {
  messages:[{role:'user',content:'Compile-only SDK01 direct-control consumer'}],
  execution:undefined,
  responseFormat:{type:'json_object'},requiredAuthMode:'oauth',
} satisfies DirectRequest;

// This is type acceptance, not provider enforcement or credential authority.
export function completeThroughPublicApi(api:OpenClawPluginApi,request:Request) {
  return api.runtime.llm.complete(request);
}

// This reads authored runtime policy; it does not establish availability or sampling support.
export function readConfiguredRuntimePolicy(api:OpenClawPluginApi,request:RuntimePolicyRequest) {
  return api.runtime.modelConfig.resolveModelRuntimePolicy(request);
}
