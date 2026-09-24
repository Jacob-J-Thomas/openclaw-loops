import type {OpenClawPluginApi,OpenClawPluginService} from 'openclaw/plugin-sdk/plugin-entry';
import {runPluginCommandWithTimeout} from 'openclaw/plugin-sdk/run-command';

// Compile-only external-plugin consumer. The managed-flow requests below are
// never dispatched; scripts/verify-expansion-sdk.mjs supplies the runtime
// qualification against a disposable Gateway and explicitly makes no model call.
type ManagedFlows = OpenClawPluginApi['runtime']['tasks']['managedFlows'];
type BoundManagedFlows = ReturnType<ManagedFlows['bindSession']>;
type AsyncManagedFlows = OpenClawPluginApi['runtime']['tasks']['async']['managedFlows'];
type BoundAsyncManagedFlows = ReturnType<AsyncManagedFlows['bindSession']>;
type CreateRequest = Parameters<BoundAsyncManagedFlows['createManaged']>[0];
type CreateResult = Awaited<ReturnType<BoundAsyncManagedFlows['createManaged']>>;
type WaitingRequest = Parameters<BoundAsyncManagedFlows['setWaiting']>[0];
type MutationResult = Awaited<ReturnType<BoundAsyncManagedFlows['requestCancel']>>;
type LinkRequest = Parameters<BoundAsyncManagedFlows['runTask']>[0];
type LinkResult = Awaited<ReturnType<BoundAsyncManagedFlows['runTask']>>;
type CreatedLink = Extract<LinkResult,{created:true}>;
type CancelRequest = Parameters<BoundManagedFlows['cancel']>[0];
type CancelResult = Awaited<ReturnType<BoundManagedFlows['cancel']>>;
type CommandRequest = Parameters<typeof runPluginCommandWithTimeout>[0];
type CommandResult = Awaited<ReturnType<typeof runPluginCommandWithTimeout>>;
type Equal<A,B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type Assert<T extends true> = T;

// A peer upgrade changing these named contracts requires renewed SDK05 review.
export type ManagedSessionBinding = Assert<Equal<Parameters<ManagedFlows['bindSession']>[0]['sessionKey'],string>>;
export type AsyncCreateRequest = Assert<CreateRequest extends {controllerId:string;goal:string} ? true : false>;
export type ManagedCreateResult = Assert<CreateResult extends {flowId:string;ownerKey:string;revision:number;syncMode:'managed';controllerId:string} ? true : false>;
export type RevisionMutation = Assert<WaitingRequest extends {flowId:string;expectedRevision:number} ? true : false>;
export type ConflictResult = Assert<MutationResult extends {applied:boolean} ? true : false>;
export type LinkedTask = Assert<LinkRequest extends {flowId:string;runtime:'subagent'|'acp'|'cron'|'cli';task:string} ? true : false>;
export type LinkedTaskRecord = Assert<CreatedLink['task'] extends {taskId:string;requesterSessionKey:string;ownerKey:string;parentFlowId?:string;childSessionKey?:string} ? true : false>;
export type LinkedTaskId = Assert<Equal<CreatedLink['task']['taskId'],string>>;
export type WaitingLinkField = Assert<Equal<Exclude<WaitingRequest['blockedTaskId'],null|undefined>,string>>;
export type NativeCancel = Assert<CancelRequest extends {flowId:string;cfg:unknown} ? true : false>;
export type NativeCancelResult = Assert<CancelResult extends {found:boolean;cancelled:boolean} ? true : false>;
export type ServiceId = Assert<Equal<OpenClawPluginService['id'],string>>;
export type ServiceContext = Assert<Parameters<OpenClawPluginService['start']>[0] extends {stateDir:string} ? true : false>;
export type TypedCommandHelper = Assert<CommandRequest extends {argv:string[];timeoutMs:number} ? true : false>;
export type TypedCommandResult = Assert<Equal<CommandResult,{code:number;stdout:string;stderr:string}>>;

export const managedCreate = {
  controllerId:'sdk05-compile-only',goal:'Compile-only managed-flow consumer',status:'queued',
} satisfies CreateRequest;

export const managedLink = {
  flowId:'flow-compile-only',runtime:'cli',task:'Compile-only task linkage',status:'queued',
} satisfies LinkRequest;

export function bindManagedFlow(api:OpenClawPluginApi,sessionKey:string) {
  return api.runtime.tasks.async.managedFlows.bindSession({sessionKey});
}

// This exported, typed helper is public and declaration-backed. It is not the
// untyped process-runtime convenience module; no missing declaration is treated
// as evidence that an executable runtime capability is absent.
export function runBoundedPluginCommand(request:CommandRequest) {
  return runPluginCommandWithTimeout(request);
}
