import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/core';

// Compile-only external-plugin consumer. It names only the pinned public SDK06
// surface and never starts, cancels, or settles a host run.
type TaskRuns = OpenClawPluginApi['runtime']['tasks']['runs'];
type BindRequest = Parameters<TaskRuns['bindSession']>[0];
type BoundRuns = ReturnType<TaskRuns['bindSession']>;
type TaskRun = ReturnType<BoundRuns['list']>[number];
type CancelRequest = Parameters<BoundRuns['cancel']>[0];
type CancelResult = Awaited<ReturnType<BoundRuns['cancel']>>;
type Subagent = OpenClawPluginApi['runtime']['subagent'];
type WaitRequest = Parameters<Subagent['waitForRun']>[0];
type InspectionRequest = Parameters<Subagent['getSessionMessages']>[0];
type Equal<A,B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type Assert<T extends true> = T;
type RequiredKeys<T> = {[K in keyof T]-?:Pick<T,K> extends Required<Pick<T,K>> ? K : never}[keyof T];

// A peer upgrade changing these named contracts requires renewed SDK06 review.
export type SessionBinding = Assert<Equal<BindRequest['sessionKey'], string>>;
export type OptionalBoundAgent = Assert<Equal<BindRequest['agentId'], string|undefined>>;
export type TaskRunIdentity = Assert<TaskRun extends {id:string;runId?:string} ? true : false>;
export type CancellationRequestKeys = Assert<Equal<RequiredKeys<CancelRequest>, 'cfg'|'taskId'>>;
export type CancellationResultShape = Assert<Equal<Pick<CancelResult,'found'|'cancelled'|'reason'|'task'>,{found:boolean;cancelled:boolean;reason?:string;task?:TaskRun}>>;
export type WaitShape = Assert<WaitRequest extends {runId:string;timeoutMs?:number} ? true : false>;
export type InspectionShape = Assert<InspectionRequest extends {sessionKey:string;limit?:number} ? true : false>;

export function bindAndMatchPublicTask(api:OpenClawPluginApi,sessionKey:string,agentId:string|undefined,runId:string) {
  const bound = api.runtime.tasks.runs.bindSession({sessionKey,agentId});
  return bound.list().find((task) => task.runId === runId);
}

export function cancelMatchedPublicTask(bound:BoundRuns,taskId:string,cfg:CancelRequest['cfg']) {
  return bound.cancel({taskId,cfg});
}

export function readCancellationResult(result:CancelResult) {
  return {found:result.found,cancelled:result.cancelled,reason:result.reason,taskRunId:result.task?.runId};
}

export function inspectPublicRun(api:OpenClawPluginApi,runId:string,sessionKey:string) {
  return Promise.all([
    api.runtime.subagent.waitForRun({runId,timeoutMs:30_000}),
    api.runtime.subagent.getSessionMessages({sessionKey,limit:20}),
  ]);
}
