import React,{useEffect,useState} from 'react';
import type {GraphNode} from './graph.js';
import {completionParameters,type Advanced,type InferenceCapabilities,type InferenceSettings} from './inference-settings.js';
import {FailureNotice,displayFailure,type DisplayFailure} from './failure-notice.js';

type InferenceNode = Extract<GraphNode,{kind:'inference'}>;
export function InferenceEditor({node,onChange,loadCapabilities}:{node:InferenceNode;onChange:(node:InferenceNode)=>void;loadCapabilities:(settings:InferenceSettings)=>Promise<InferenceCapabilities>}){
  const [capabilities,setCapabilities]=useState<InferenceCapabilities>();
  const [error,setError]=useState<DisplayFailure>('');
  useEffect(()=>{
    let current=true;
    setCapabilities(undefined);setError('');
    const timer=setTimeout(()=>{void loadCapabilities({model:node.model,agentId:node.agentId}).then(result=>{if(current)setCapabilities(result);},failure=>{if(current)setError(displayFailure(failure));});},150);
    return()=>{current=false;clearTimeout(timer);};
  },[node.model,node.agentId,loadCapabilities]);
  const setSetting=(key:keyof Advanced,value:Advanced[keyof Advanced]|undefined)=>{
    const next={...node.advanced};
    if(value===undefined)delete next[key];else Object.assign(next,{[key]:value});
    const edited={...node};if(Object.keys(next).length)edited.advanced=next;else delete edited.advanced;
    onChange(edited);
  };
  const setOptional=(key:'model'|'agentId'|'reasoning',value:string)=>{const next={...node};if(value)Object.assign(next,{[key]:value});else delete next[key];onChange(next);};
  return <>
    <label className="lp-field"><span>Agent override</span><input value={node.agentId??''} placeholder="Use current agent" onChange={e=>setOptional('agentId',e.target.value)}/></label>
    <label className="lp-field"><span>Model</span><input value={node.model??''} placeholder={capabilities?.model?`Use host default ${capabilities.model}`:'Use host default model'} onChange={e=>setOptional('model',e.target.value)}/></label>
    <label className="lp-field"><span>Reasoning</span><select value={node.reasoning??''} onChange={e=>setOptional('reasoning',e.target.value)}><option value="">Inherit conversation / host</option>{['off','minimal','low','medium','high','xhigh','adaptive','max','ultra'].map(level=><option key={level}>{level}</option>)}</select></label>
    <details className="lp-advanced"><summary>Advanced settings {node.advanced&&Object.keys(node.advanced).length?`(${Object.keys(node.advanced).length} overrides)`:''}</summary>
      <p className="lp-hint">Empty fields inherit OpenClaw defaults. Advisory settings may be ignored by the selected runtime. Zero is an explicit value.</p>
      <FailureNotice failure={error} label="Model capability failure"/>
      {(capabilities?.parameters??completionParameters()).map(parameter=>{
        const value=node.advanced?.[parameter.key];const unavailable=parameter.support==='unsupported'||parameter.support==='unknown';
        return <div key={parameter.key} className="lp-advanced-field">
          <label className="lp-field"><span>{parameter.label} <small>· {parameter.support}</small></span>
            {parameter.type==='string[]'?<textarea rows={2} value={Array.isArray(value)?value.join('\n'):''} placeholder="Inherit · one stop sequence per line" disabled={unavailable} onChange={e=>setSetting(parameter.key,e.target.value?e.target.value.split('\n'):undefined)}/>
              :<input type="number" step={parameter.type==='integer'?1:'any'} min={parameter.minimum} max={parameter.maximum} value={typeof value==='number'?value:''} placeholder={parameter.defaultValue===undefined?'Inherit · provider default':`Inherit ${parameter.defaultValue}`} disabled={unavailable} onChange={e=>setSetting(parameter.key,e.target.value===''?undefined:Number(e.target.value))}/>}
          </label>
          <p className="lp-hint">{parameter.reason}</p>
          {value!==undefined&&<button className="lp-text-button" onClick={()=>setSetting(parameter.key,undefined)}>Reset {parameter.label.toLowerCase()}</button>}
          {value!==undefined&&unavailable&&<p className="lp-validation-error">This saved override is incompatible with the current runtime. Reset it or select a supported runtime.</p>}
        </div>;
      })}
      <button disabled={!node.advanced} onClick={()=>{const next={...node};delete next.advanced;onChange(next);}}>Reset all Advanced settings</button>
    </details>
  </>;
}
