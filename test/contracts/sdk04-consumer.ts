import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/core';

// Compile-only external-plugin consumer. It never dispatches a subagent run.
// npm run typecheck pins the named public SDK04 shape to the 2026.9.5 peer.
type Subagent = OpenClawPluginApi['runtime']['subagent'];
type Run = Subagent['run'];
type RunRequest = Parameters<Run>[0];
type RunResult = Awaited<ReturnType<Run>>;
type Wait = Subagent['waitForRun'];
type WaitRequest = Parameters<Wait>[0];
type Inspect = Subagent['getSessionMessages'];
type InspectRequest = Parameters<Inspect>[0];
type Equal<A,B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type Assert<T extends true> = T;

// A peer upgrade changing these named contracts requires renewed SDK04 review.
export type CurrentRequesterDelivery = Assert<Equal<RunRequest['completionDelivery'], 'current-requester'|undefined>>;
export type ToolFreeRun = Assert<Equal<RunRequest['disableTools'], boolean|undefined>>;
export type IdempotentRun = Assert<Equal<RunRequest['idempotencyKey'], string|undefined>>;
export type RunIdentity = Assert<RunResult extends {runId:string;sessionKey?:string} ? true : false>;
export type WaitShape = Assert<WaitRequest extends {runId:string;timeoutMs?:number} ? true : false>;
export type InspectionShape = Assert<InspectRequest extends {sessionKey:string;limit?:number} ? true : false>;

export const namedCurrentRequesterRun = {
  sessionKey: 'agent:main:synthetic',
  message: 'Compile-only SDK04 consumer',
  disableTools: true,
  deliver: true,
  completionDelivery: 'current-requester',
  idempotencyKey: 'sdk04-compile-only',
} satisfies RunRequest;

export function inspectAcceptedRun(api:OpenClawPluginApi,runId:string,sessionKey:string) {
  return Promise.all([
    api.runtime.subagent.waitForRun({runId,timeoutMs:120000}),
    api.runtime.subagent.getSessionMessages({sessionKey,limit:20}),
  ]);
}
