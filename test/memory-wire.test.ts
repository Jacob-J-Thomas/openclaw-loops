import {describe,expect,it} from 'vitest';
import {Value} from 'typebox/value';
import type {TSchema} from 'typebox';
// @ts-expect-error OpenClaw exports this public runtime helper as JavaScript.
import {validateJsonSchemaValue} from 'openclaw/plugin-sdk/json-schema-runtime';
import {DataSchemaWireRef,dataSchemaIssues,type DataSchema} from '../src/data-schema.js';
import {examples} from '../src/examples.js';
import {validateGraph,type Definition} from '../src/graph.js';
import {wireContract} from '../src/wire-contract.js';

type WireSchema=TSchema&{properties:{definition:unknown};$defs:Record<string,unknown>};
const input=wireContract.operations.validate.input as WireSchema;
const definition=():Definition=>{
  const result=structuredClone(examples[0]);
  result.schemaVersion=3;
  result.memorySchemas=[{id:'note',version:1,schema:{type:'object',properties:{value:{type:'array',items:{type:'string'}}},required:['value'],additionalProperties:false}}];
  return result;
};
const hostAccepts=(value:unknown,tag:string)=>validateJsonSchemaValue({schema:input,cacheKey:`issue275-memory-wire-${tag}`,cache:false,value}).ok;

describe('memory schema public wire',()=>{
  it('uses the shared root-local recursive data schema at the memory entry slot',()=>{
    const json=JSON.stringify(input);
    expect(json).toContain('"memorySchemas"');
    expect(json).toContain('"$ref":"#/$defs/loops_data_schema"');
    expect(input.$defs).toHaveProperty('loops_data_schema');
    expect(input.$defs).toHaveProperty('loops_json_value');
    const schemas:Array<unknown>=[];
    const visit=(value:unknown)=>{
      if(!value||typeof value!=='object')return;
      if(Array.isArray(value)){for(const child of value)visit(child);return;}
      const object=value as Record<string,unknown>;
      if('memorySchemas' in object&&object.memorySchemas&&typeof object.memorySchemas==='object'){
        const items=(object.memorySchemas as {items?:{properties?:{schema?:unknown}}}).items;
        if(items?.properties?.schema!==undefined)schemas.push(items.properties.schema);
      }
      for(const child of Object.values(object))visit(child);
    };
    visit(input.properties.definition);
    expect(schemas.length).toBeGreaterThan(0);
    expect(schemas.every(schema=>JSON.stringify(schema)===JSON.stringify(DataSchemaWireRef))).toBe(true);
  });

  it('accepts recursive memory schemas and rejects unknown and cross-kind fields at the registered tool input',()=>{
    const valid=definition();
    expect(dataSchemaIssues(valid.memorySchemas![0]!.schema)).toEqual([]);
    expect(validateGraph(valid)).toEqual([]);
    expect(Value.Check(input,{definition:valid})).toBe(true);
    expect(hostAccepts({definition:valid},'valid')).toBe(true);
    for(const schema of [
      {type:'object',properties:{value:{type:'string',alien:true}},additionalProperties:false},
      {type:'array',items:{type:'string'},properties:{cross:{type:'number'}}},
      {type:'array'},
      {type:'string',alien:true},
    ]){
      expect(dataSchemaIssues(schema).length).toBeGreaterThan(0);
      const invalid=structuredClone(valid);
      invalid.memorySchemas![0]!.schema=schema as DataSchema;
      expect(validateGraph(invalid).length).toBeGreaterThan(0);
      expect(Value.Check(input,{definition:invalid}),JSON.stringify(schema)).toBe(false);
      expect(hostAccepts({definition:invalid},JSON.stringify(schema)),JSON.stringify(schema)).toBe(false);
    }
  });
});
