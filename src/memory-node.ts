import {Type} from 'typebox';
import {requestError} from './errors.js';
import {NodeValueSchema,type NodeValue} from './node-values.js';

const strict={additionalProperties:false} as const;
export type MemoryNodeOperation='consume'|'search'|'inspect'|'write'|'update'|'forget'|'mutation'|'retention-preview'|'retention-apply'|'reset-preview'|'reset-apply';
export const MemoryNodeOperationSchema=Type.Unsafe<MemoryNodeOperation>({type:'string',enum:['consume','search','inspect','write','update','forget','mutation','retention-preview','retention-apply','reset-preview','reset-apply']});
export const MemoryNodeConfigSchema=Type.Object({operation:MemoryNodeOperationSchema,key:NodeValueSchema,value:Type.Optional(NodeValueSchema),expectedVersion:Type.Optional(NodeValueSchema),plan:Type.Optional(NodeValueSchema),limit:Type.Optional(Type.Integer({minimum:1,maximum:50}))},strict);
export type MemoryNodeConfig={operation:MemoryNodeOperation;key:NodeValue;value?:NodeValue;expectedVersion?:NodeValue;plan?:NodeValue;limit?:number};
export function validateMemoryNode(config:MemoryNodeConfig){
  if(['write','update'].includes(config.operation)&&config.value===undefined)throw requestError(`${config.operation} requires an authored memory value.`);
  if(['update','forget'].includes(config.operation)&&config.expectedVersion===undefined)throw requestError(`${config.operation} requires an expected memory version.`);
  if(config.operation.endsWith('-apply')&&config.plan===undefined)throw requestError(`${config.operation} requires a preview plan binding.`);
  if(config.value!==undefined&&!['write','update'].includes(config.operation))throw requestError('Only Memory write/update accepts a value.');
  if(config.expectedVersion!==undefined&&!['update','forget'].includes(config.operation))throw requestError('Only Memory update/forget accepts an expected version.');
  if(config.plan!==undefined&&!config.operation.endsWith('-apply'))throw requestError('Only Memory retention/reset apply accepts a preview plan.');
}
