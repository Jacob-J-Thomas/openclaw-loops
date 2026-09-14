import type {FeatureInvocationContext} from 'openclaw/plugin-sdk/feature-plugin';
import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/core';

// Compile-only external-plugin consumer. These synthetic requests never dispatch.
// npm run typecheck checks the public exports against the pinned peer version.
type Command = Extract<FeatureInvocationContext,{source:'command'}>['command'];
type Tool = Extract<FeatureInvocationContext,{source:'tool'}>['tool'];
type Action = Extract<FeatureInvocationContext,{source:'session-action'}>['action'];
type Complete = OpenClawPluginApi['runtime']['llm']['complete'];
type Request = Parameters<Complete>[0];
type Result = Awaited<ReturnType<Complete>>;
type Equal<A,B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type Assert<T extends true> = T;

// A peer upgrade changing these named contracts requires renewed qualification.
export type ToolHasNoCompleterMembers = Assert<Equal<Extract<keyof Tool,'runtimeContext'|'llm'|'complete'>,never>>;
export type ActionHasNoCompleterMembers = Assert<Equal<Extract<keyof Action,'runtimeContext'|'llm'|'complete'>,never>>;
export type ResultFields = Assert<Equal<keyof Result,'text'|'provider'|'model'|'agentId'|'usage'|'execution'|'audit'>>;

// Runtime acceptance is host-policy-gated; typechecking establishes no account authority.
export const policyGatedRequest = {
  messages:[{role:'user',content:'Compile-only SDK02 consumer'}],
  execution:{mode:'isolated-agent-runtime',authProfileId:'synthetic-profile'},
  model:'example/model',reasoning:'low',
} satisfies Request;

export function commandBoundComplete(context:Command,request:Request) {
  return context.runtimeContext?.llm?.complete(request);
}

export function completeThroughPublicApi(api:OpenClawPluginApi,request:Request) {
  return api.runtime.llm.complete(request);
}
