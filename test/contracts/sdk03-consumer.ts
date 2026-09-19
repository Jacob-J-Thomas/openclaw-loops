import type {FeatureInvocationContext} from 'openclaw/plugin-sdk/feature-plugin';
import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/core';

// Compile-only external-plugin consumer. It never reads a transcript or invokes
// the host; npm run typecheck pins the public current-invocation contract.
type Command = Extract<FeatureInvocationContext,{source:'command'}>['command'];
type Tool = Extract<FeatureInvocationContext,{source:'tool'}>['tool'];
type Action = Extract<FeatureInvocationContext,{source:'session-action'}>['action'];
type SessionLookup = OpenClawPluginApi['runtime']['agent']['session']['getSessionEntry'];
type SessionLookupRequest = Parameters<SessionLookup>[0];
type Equal<A,B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type Assert<T extends true> = T;

// A peer upgrade changing any asserted host-attested current facts requires
// renewed SDK03 qualification. These facts do not authorize a chosen target.
export type CommandCurrentIdentity = Assert<Equal<
  Pick<Command,'isAuthorizedSender'|'senderIsOwner'|'gatewayClientScopes'|'agentId'|'sessionKey'|'sessionId'|'sessionTarget'>,
  {isAuthorizedSender:boolean;senderIsOwner?:boolean;gatewayClientScopes?:string[];agentId?:string;sessionKey?:string;sessionId?:string;sessionTarget?:{agentId:string;sessionId:string;sessionKey:string;storePath:string}}
>>;
export type ToolCurrentIdentity = Assert<Equal<
  Pick<Tool,'agentId'|'sessionKey'|'sessionId'|'requesterSenderId'|'senderIsOwner'|'conversationRecall'>,
  {agentId?:string;sessionKey?:string;sessionId?:string;requesterSenderId?:string;senderIsOwner?:boolean;conversationRecall?:{anchorSessionKey:string;scope:'same-agent-private';corpus:'sessions'|'configured'}}
>>;
export type ActionCurrentIdentity = Assert<Equal<
  Pick<Action,'agentId'|'sessionKey'|'client'>,
  {agentId?:string;sessionKey?:string;client?:{connId?:string;scopes:string[]}}
>>;
// The lookup accepts caller-selected keys. This shape alone is not authorization.
export type SessionLookupRequestShape = Assert<SessionLookupRequest extends {sessionKey:string;agentId?:string;readConsistency?:'latest'} ? true : false>;

export function lookupCurrentSession(api:OpenClawPluginApi,context:Command) {
  if (!context.agentId || !context.sessionKey) return undefined;
  return api.runtime.agent.session.getSessionEntry({agentId:context.agentId,sessionKey:context.sessionKey,readConsistency:'latest'});
}
