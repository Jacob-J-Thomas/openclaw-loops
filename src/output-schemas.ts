import {Type} from 'typebox';
import {DefinitionSchema} from './graph.js';
import type {Engine,LoopRecord,Run} from './engine.js';
import type {RunReceipt,describe} from './receipts.js';
import type {InferenceCapabilities} from './inference-settings.js';

// Each operation publishes a concrete wire shape. Dynamic JSON data and host
// attribution remain open values; identities, states and control fields do not.
const strict={additionalProperties:false} as const;
const text=Type.String(),integer=Type.Integer({minimum:0});
const nullableRevision=Type.Union([Type.Integer({minimum:1}),Type.Null()]);
const enums=(values:string[])=>Type.Union(values.map(value=>Type.Literal(value)));
const runState=enums(['queued','running','completed','failed','waiting','review','cancelled','interrupted']);
const attemptState=enums(['running','completed','waiting','review','failed','cancelled','interrupted']);
const owner=Type.Object({agentId:text,sessionKey:text,sessionId:text},strict);
const error=Type.Object({code:text,message:text,phase:text,nodeId:Type.Optional(text),model:Type.Optional(text),retryable:Type.Boolean(),recovery:text},strict);
const review=Type.Object({decision:enums(['approve','reject']),at:text,requester:text},strict);
const summary=Type.Object({id:text,slug:text,name:text,revision:Type.Integer({minimum:0})},strict);
const issues=Type.Array(Type.Object({nodeId:Type.Optional(text),message:text},strict));
const runRow=Type.Object({id:text,slug:text,revision:integer,state:runState,createdAt:text,updatedAt:text,executions:integer},strict);
const loopRecord=Type.Object({
  definition:DefinitionSchema,enabledRevision:nullableRevision,grants:DefinitionSchema.properties.capabilities,
  revisions:Type.Optional(Type.Record(text,DefinitionSchema)),publishedRevision:Type.Optional(nullableRevision),
  revoked:Type.Optional(Type.Boolean()),archived:Type.Optional(Type.Boolean()),deletedAt:Type.Optional(text),
},strict);
const record=Type.Unsafe<LoopRecord>(loopRecord);
const receipt=Type.Unsafe<RunReceipt>(Type.Object({
  id:text,state:runState,owner,source:enums(['command','tool','session-action']),requester:Type.Optional(text),definition:summary,
  executions:integer,createdAt:text,updatedAt:text,models:Type.Array(text),
  result:Type.Optional(Type.Unknown()),resultPreview:Type.Optional(text),resultTruncated:Type.Optional(Type.Boolean()),
  pending:Type.Optional(text),pendingTruncated:Type.Optional(Type.Boolean()),error:Type.Optional(text),errorDetail:Type.Optional(error),
  uncertainty:Type.Optional(text),review:Type.Optional(review),cleanupPending:Type.Optional(Type.Boolean()),parentRunId:Type.Optional(text),testMode:Type.Optional(Type.Boolean()),
  steps:Type.Array(Type.Object({nodeId:text,state:attemptState,iteration:Type.Optional(integer)},strict)),inspection:text,
},strict));
const completeRun=Type.Unsafe<Run>(Type.Object({
  id:text,requestKey:text,requestFingerprint:text,owner,source:enums(['command','tool','session-action']),requester:Type.Optional(text),
  executionSettings:Type.Optional(Type.Object({model:Type.Optional(text),reasoning:Type.Optional(text),authProfileId:Type.Optional(text)},strict)),
  cleanupPending:Type.Optional(Type.Boolean()),parentRunId:Type.Optional(text),testMode:Type.Optional(Type.Boolean()),
  definition:DefinitionSchema,input:Type.Record(text,Type.Unknown()),state:runState,cursor:text,outputs:Type.Record(text,Type.Unknown()),
  trace:Type.Array(Type.Object({nodeId:text,kind:text,iteration:Type.Optional(integer),state:attemptState,startedAt:text,endedAt:Type.Optional(text),output:Type.Optional(text),error:Type.Optional(text)},strict)),
  executions:integer,activeMs:Type.Number({minimum:0}),createdAt:text,updatedAt:text,result:Type.Optional(Type.Unknown()),error:Type.Optional(text),
  errorDetail:Type.Optional(error),pending:Type.Optional(text),uncertainty:Type.Optional(text),review:Type.Optional(review),
},strict));
export const outputs={
  receipt,record,completeRun,
  saved:Type.Unsafe<ReturnType<Engine['save']>>(Type.Object({record:loopRecord,issues},strict)),
  validation:Type.Unsafe<ReturnType<Engine['validate']>>(Type.Object({valid:Type.Boolean(),issues},strict)),
  versions:Type.Unsafe<ReturnType<Engine['versions']>>(Type.Array(Type.Object({revision:integer,name:text,enabled:Type.Boolean(),published:Type.Boolean(),definition:DefinitionSchema},strict))),
  deleted:Type.Unsafe<ReturnType<Engine['deleted']>>(Type.Array(Type.Object({id:text,slug:text,revision:integer,deletedAt:Type.Optional(text),archived:Type.Boolean()},strict))),
  output:Type.Unsafe<ReturnType<Engine['output']>>(Type.Object({runId:text,nodeId:Type.Union([text,Type.Null()]),text,offset:integer,nextOffset:Type.Union([integer,Type.Null()]),totalCharacters:integer,format:enums(['text','json'])},strict)),
  history:Type.Unsafe<ReturnType<Engine['history']>>(Type.Object({items:Type.Array(runRow),nextCursor:Type.Union([integer,Type.Null()]),total:integer},strict)),
  runs:Type.Unsafe<ReturnType<Engine['runs']>>(Type.Array(runRow)),
  library:Type.Unsafe<ReturnType<Engine['library']>>(Type.Array(Type.Object({...summary.properties,description:text,enabledRevision:nullableRevision,publishedRevision:nullableRevision,hasDraft:Type.Boolean(),capabilities:DefinitionSchema.properties.capabilities},strict))),
  list:Type.Unsafe<ReturnType<Engine['list']>>(Type.Array(Type.Object({...summary.properties,description:text,inputSchema:DefinitionSchema.properties.inputSchema},strict))),
  describe:Type.Unsafe<ReturnType<typeof describe>>(Type.Object({...summary.properties,description:text,inputSchema:DefinitionSchema.properties.inputSchema,capabilities:DefinitionSchema.properties.capabilities,limits:DefinitionSchema.properties.limits,steps:Type.Array(Type.Object({id:text,kind:text,label:text},strict))},strict)),
  deletion:Type.Unsafe<ReturnType<Engine['delete']>>(Type.Object({id:text,slug:text,revision:integer,deleted:Type.Boolean()},strict)),
  capabilities:Type.Unsafe<InferenceCapabilities>(Type.Object({
    model:Type.Optional(text),runtime:Type.Optional(text),configured:Type.Union([Type.Boolean(),Type.Literal('unknown')]),authorized:Type.Union([Type.Boolean(),Type.Literal('unknown')]),available:Type.Union([Type.Boolean(),Type.Literal('unknown')]),
    parameters:Type.Array(Type.Object({key:text,label:text,type:enums(['number','integer','string[]']),support:enums(['supported','advisory','unsupported','unknown']),reason:text,minimum:Type.Optional(Type.Number()),maximum:Type.Optional(Type.Number()),defaultValue:Type.Optional(Type.Union([Type.Number(),Type.Array(text)]))},strict)),notes:Type.Array(text),
  },strict)),
};
