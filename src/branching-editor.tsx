import React,{useState} from 'react';
import type {GraphNode,Json} from './graph.js';
import {literalValue,type NodeValue} from './node-values.js';
import {ValueEditor} from './value-editor.js';
import type {SwitchNode,TypedCondition,TypedConditionNode,TypedOperator} from './branching.js';

const operators:TypedOperator[]=['exists','missing','type-is','equals','not-equals','less-than','less-than-or-equals','greater-than','greater-than-or-equals','in','not-in'];
const needsExpected=(operator:TypedOperator)=>!['exists','missing','type-is'].includes(operator);
const Field=({label,children}:{label:string;children:React.ReactNode})=><label className="lp-field"><span>{label}</span>{children}</label>;

const equivalentTypedOperator=(operator:Extract<GraphNode,{kind:'condition'}>['predicate']['op']):Extract<TypedOperator,'equals'|'not-equals'>|undefined=>operator==='equals'||operator==='not-equals'?operator:undefined;

/** Only convert legacy predicates whose observable v3 behavior is identical. */
export function typedConditionFrom(node:Extract<GraphNode,{kind:'condition'}>):TypedConditionNode|undefined{
  const operator=equivalentTypedOperator(node.predicate.op);
  return operator?{...node,condition:{value:node.predicate.left,operator,expected:node.predicate.right}} as TypedConditionNode:undefined;
}

export function typedRewriteHint(operator:Extract<GraphNode,{kind:'condition'}>['predicate']['op']):string{
  return `The legacy ${operator} comparison has no semantics-preserving typed conversion. Rewrite it explicitly as a typed condition.`;
}
export function TypedConditionEditor({value,onChange}:{value:TypedCondition;onChange:(value:TypedCondition)=>void}){
  return <div className="lp-typed-condition">
    <ValueEditor label="Value or binding" value={value.value} literals onChange={next=>onChange({...value,value:next})}/>
    <Field label="Typed comparison"><select value={value.operator} onChange={event=>{const operator=event.target.value as TypedOperator;onChange({value:value.value,operator,...needsExpected(operator)?{expected:value.expected??{literalJson:'null'}}:{},...operator==='type-is'?{jsonType:value.jsonType??'string'}:{}});}}>{operators.map(operator=><option key={operator} value={operator}>{operator}</option>)}</select></Field>
    {value.operator==='type-is'&&<Field label="JSON type"><select value={value.jsonType??'string'} onChange={event=>onChange({...value,jsonType:event.target.value as NonNullable<TypedCondition['jsonType']>})}>{['null','boolean','number','string','array','object'].map(type=><option key={type}>{type}</option>)}</select></Field>}
    {needsExpected(value.operator)&&<ValueEditor label="Expected typed value or binding" value={value.expected??{literalJson:'null'}} literals onChange={expected=>onChange({...value,expected})}/>}
    <p className="lp-hint">Exists and missing distinguish an absent binding from a JSON null. Other operators report unavailable or wrong-type values as execution errors.</p>
  </div>;
}
function CaseValue({value,onChange,label}:{value:Json;onChange:(value:Json)=>void;label:string}){
  const [error,setError]=useState('');
  const apply=(next:NodeValue)=>{if(typeof next==='string'){setError('Switch cases are typed literals; use the literal JSON editor.');return;}try{onChange(literalValue(next.literalJson));setError('');}catch(cause){setError(cause instanceof Error?cause.message:'Invalid JSON literal.');}};
  return <><ValueEditor label={label} value={{literalJson:JSON.stringify(value)}} literals onChange={apply}/>{error&&<p className="lp-node-error" role="alert">{error}</p>}</>;
}
export function SwitchEditor({node,onChange,fresh}:{node:SwitchNode;onChange:(node:SwitchNode)=>void;fresh:(prefix:string)=>string}){
  const updateCase=(index:number,patch:Partial<SwitchNode['cases'][number]>)=>onChange({...node,cases:node.cases.map((item,current)=>current===index?{...item,...patch}:item)});
  return <div className="lp-switch-editor">
    <ValueEditor label="Switch value or binding" value={node.value} literals onChange={value=>onChange({...node,value})}/>
    <Field label="Case matching"><select value={node.strategy} onChange={event=>onChange({...node,strategy:event.target.value as SwitchNode['strategy']})}><option value="unique">Unique typed cases</option><option value="ordered">Ordered typed cases</option></select></Field>
    <h4>Cases</h4>
    {node.cases.map((item,index)=><section className="lp-switch-case" key={item.id} aria-label={'Switch case '+(index+1)}>
      <Field label={'Case '+(index+1)+' label'}><input value={item.label} onChange={event=>updateCase(index,{label:event.target.value})}/></Field>
      <div className="lp-mono lp-muted">Stable port ID · {item.id}</div>
      <CaseValue label={'Case '+(index+1)+' typed value'} value={item.value} onChange={value=>updateCase(index,{value})}/>
      <button className="lp-text-button" onClick={()=>onChange({...node,cases:node.cases.filter((_,current)=>current!==index)})}>Remove case</button>
    </section>)}
    <button onClick={()=>onChange({...node,cases:[...node.cases,{id:fresh('case'),label:'New case',value:null}]})}>+ Add case</button>
    <label className="lp-check"><input type="checkbox" checked={node.default===true} onChange={event=>onChange({...node,...event.target.checked?{default:true,exhaustive:undefined}:{default:undefined}})}/>Use default route</label>
    <label className="lp-check"><input type="checkbox" checked={node.exhaustive==='boolean'} onChange={event=>onChange({...node,...event.target.checked?{exhaustive:'boolean',default:undefined}:{exhaustive:undefined}})}/>Exhaustive boolean cases</label>
    <p className="lp-hint">Each displayed case ID is its connection port. Default is required unless both boolean values are explicitly covered.</p>
  </div>;
}
