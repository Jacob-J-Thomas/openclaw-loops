import {Type} from 'typebox';
import {Value} from 'typebox/value';

// Storage/execution budgets are independent of the host's per-message envelope.
// New version 2 work uses operator settings; version 1 keeps historical limits.
export const defaultBudgets={definitionBytes:4*1024*1024,inputBytes:1024*1024,promptBytes:1024*1024,defaultOutputBytes:1024*1024,defaultExecutions:1000,defaultRepeat:3};
export type Budgets=typeof defaultBudgets;
export const legacyBudgets={definitionBytes:64000,inputBytes:16000,promptBytes:20000};
const integer=(minimum:number)=>Type.Integer({minimum,maximum:Number.MAX_SAFE_INTEGER});
export const BudgetsSchema=Type.Object({definitionBytes:integer(128),inputBytes:integer(2),promptBytes:integer(1),defaultOutputBytes:integer(128),defaultExecutions:integer(2),defaultRepeat:integer(1)},{additionalProperties:false});
export const pluginConfigSchema=Type.Object({
  maxConcurrentRuns:Type.Optional(Type.Integer({minimum:1,maximum:Number.MAX_SAFE_INTEGER,default:1,description:'Maximum executing/settling runs. Additional requests queue. Keep 1 for a 16 GB local-model machine.'})),
  budgets:Type.Optional(Type.Partial(BudgetsSchema,{additionalProperties:false})),
},{additionalProperties:false});
export function parsePluginConfig(value:unknown){const config=value??{};if(!Value.Check(pluginConfigSchema,config))throw new Error('Invalid Loops configuration: use known fields and positive safe-integer budgets.');return config;}
export function resolveBudgets(value:Partial<Budgets>={}):Budgets{const budgets={...defaultBudgets,...value};if(!Value.Check(BudgetsSchema,budgets))throw new Error('Invalid execution budgets.');return budgets;}
