import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/core';

// Compile-only external-plugin consumer. These requests are never dispatched.
// npm run typecheck checks this file against the exact declared peer version.
type Complete = OpenClawPluginApi['runtime']['llm']['complete'];
type Request = Parameters<Complete>[0];
type Result = Awaited<ReturnType<Complete>>;
type Equal<A,B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type Assert<T extends true> = T;
type SamplingKey = 'temperature'|'topP'|'topK'|'minP'|'typicalP'|
  'frequencyPenalty'|'presencePenalty'|'repetitionPenalty'|'seed'|'stop'|'maxTokens';

// A peer upgrade changing these contracts requires renewed qualification.
export type AvailableSampling = Assert<Equal<Extract<keyof Request,SamplingKey>,'temperature'|'maxTokens'>>;
export type CompletionAttribution = Assert<Equal<keyof Result,'text'|'provider'|'model'|'agentId'|'usage'|'execution'|'audit'>>;
export type LlmHasNoCapabilitiesMember = Assert<Equal<Extract<keyof OpenClawPluginApi['runtime']['llm'],'capabilities'>,never>>;

export const inheritedRequest = {
  messages:[{role:'user',content:'Compile-only SDK01 consumer'}],
  execution:{mode:'isolated-agent-runtime'},
} satisfies Request;

export const overrideRequest = {
  messages:[{role:'user',content:'Compile-only SDK01 consumer'}],
  execution:{mode:'isolated-agent-runtime'},
  model:'example/model',temperature:0,maxTokens:96,reasoning:'low',
} satisfies Request;

// This is type acceptance, not provider enforcement or credential authority.
export function completeThroughPublicApi(api:OpenClawPluginApi,request:Request) {
  return api.runtime.llm.complete(request);
}
