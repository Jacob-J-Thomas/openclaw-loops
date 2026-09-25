import React,{useMemo,useState} from 'react';
import {Background,Controls,MiniMap,ReactFlow,Handle,MarkerType,Position,type Edge,type Node} from '@xyflow/react';
import type {Run} from './engine.js';
import {ports,type GraphNode,type Json} from './graph.js';
import {nodeContract} from './node-contracts.js';
import {graphEdgeLabel,graphNodeLabel,selectionChange} from './graph-accessibility.js';
import type {ContextJournalEntry,ContextState} from './context.js';
import {truncateCodePoints} from './unicode.js';

type InspectionNode=Node<{node:GraphNode;output:OutputState},'inspection'>;
type OutputState={label:string;value?:Json|string;checkpoint?:{label:string;value:Json|string};route?:NonNullable<Run['trace'][number]['route']>};
export const readOnlyGraphAriaLabelConfig={
  'node.a11yDescription.default':'Press Enter or Space to select a node and inspect its pinned evidence. This graph is read only.',
  'node.a11yDescription.keyboardDisabled':'Press Enter or Space to select a node and inspect its pinned evidence. This graph is read only.',
  'edge.a11yDescription.default':'Read-only connection. Connections cannot be changed here.',
};

function display(value:unknown){return typeof value==='string'?value:JSON.stringify(value,null,2);}
const contextPageSize=8_000,journalPageSize=50;
export function contextPage(value:unknown,limit=contextPageSize){const text=display(value),visible=truncateCodePoints(text,limit);return {text,visible,incomplete:visible.length<text.length};}
function PagedJson({value,label}:{value:unknown;label:string}){
  const [limit,setLimit]=useState(contextPageSize),page=contextPage(value,limit);
  return <><pre className="lp-context-value" aria-label={label}>{page.visible}</pre>{page.incomplete&&<button type="button" onClick={()=>setLimit(current=>current+contextPageSize)}>Show more context</button>}</>;
}
export function journalSource(source:ContextJournalEntry['source']){
  if(source.kind==='output')return source.path===undefined?'This node’s full output':`This node’s output at ${source.path}`;
  const text=display(source.value),visible=truncateCodePoints(text,512);
  return `Typed literal ${visible}${visible.length<text.length?'…':''}`;
}
function ContextProvenance({context}:{context:ContextState|undefined}){
  const [journalLimit,setJournalLimit]=useState(journalPageSize);
  if(!context)return <details className="lp-context-provenance" open><summary>Shared context provenance</summary><p className="lp-hint">This run has no shared context. It was authored before version 3 context was enabled, or no context state was retained.</p></details>;
  const entries=context.journal.slice(0,journalLimit);
  return <details className="lp-context-provenance" open><summary>Shared context provenance</summary>
    <p className="lp-hint">Context version {context.version}. Values are retained execution state; journal rows are ordered commit provenance.</p>
    <h4>Current context value</h4><PagedJson value={context.value} label="Current shared context value"/>
    <h4>Committed patch journal</h4>{entries.length===0?<p className="lp-muted">No node committed a context patch in this run.</p>:<ol className="lp-context-journal">{entries.map(entry=><li key={`${entry.version}-${entry.nodeId}`}><strong>v{entry.baseVersion} → v{entry.version} · {entry.nodeId}</strong><span>{entry.mode} <code>{entry.target}</code> from {journalSource(entry.source)}</span><span>Resolved value SHA-256 <code>{entry.valueSha256}</code> · {entry.valueBytes} bytes</span></li>)}</ol>}
    {entries.length<context.journal.length&&<button type="button" onClick={()=>setJournalLimit(current=>current+journalPageSize)}>Show more journal entries</button>}
  </details>;
}
export function inspectionOutput(run:Run,nodeId:string):OutputState{
  const evidence=[...run.trace].reverse().find(item=>item.nodeId===nodeId);
  const node=run.definition.nodes.find(item=>item.id===nodeId);
  const hasOutput=Object.hasOwn(run.outputs,nodeId),value=run.outputs[nodeId];
  const recorded={label:run.parentRunId?evidence?.state==='completed'&&Object.hasOwn(evidence,'output')?'Recorded in this recovery':'Inherited from parent run':'Recorded output',value,...evidence?.route?{route:evidence.route}:{}};
  if(node?.kind==='evaluate'&&hasOutput&&value&&typeof value==='object'&&!Array.isArray(value)&&value.kind==='loops-evaluation')return {...recorded,label:`Committed evaluation evidence · ${value.passed===true?'passed':'failed'}`};
  if(node?.kind==='gate'&&hasOutput&&value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.passed==='boolean')return {...recorded,label:`Evidence gate · ${value.passed?'pass route':'fail route'}`};
  if(node?.kind==='wait'||node?.kind==='review'){
    const title=node.kind==='wait'?'Wait checkpoint':'Human review proposal';
    const pending=run.cursor===nodeId&&run.pending!==undefined&&((node.kind==='wait'&&run.state==='waiting')||(node.kind==='review'&&run.state==='review'));
    const checkpoint=pending?{label:`Pending ${title}`,value:run.pending!}:evidence&&Object.hasOwn(evidence,'output')?{label:`${title} evidence`,value:evidence.output!}:undefined;
    const placeholder=value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===0;
    if(hasOutput&&!placeholder)return {...recorded,...checkpoint?{checkpoint}:{}};
    if(checkpoint)return checkpoint;
    if(hasOutput)return {label:run.parentRunId?'See parent run for checkpoint evidence':'No checkpoint evidence recorded'};
  }
  if(hasOutput)return recorded;
  if(evidence&&Object.hasOwn(evidence,'output'))return {label:'Recorded trace output',value:evidence.output!};
  if(evidence?.rejectedResponse){const rejected=evidence.rejectedResponse;return {label:'Rejected model response · never checkpointed',value:`${rejected.preview}${rejected.truncated?'…':''}\n${rejected.bytes} bytes · SHA-256 ${rejected.sha256}`};}
  if(evidence)return {label:`${evidence.state} without output`};
  return {label:'Node was not started'};
}
function settings(node:GraphNode){return display(node);}
function InspectionNodeCard({data,selected}:{data:InspectionNode['data'];selected?:boolean}){
  const {node,output}=data;
  return <div className={`lp-run-node ${selected?'selected':''}`} data-kind={node.kind} aria-label={`${node.label}, ${nodeContract(node.kind).editor.title}`}>
    {node.kind!=='input'&&<Handle type="target" position={Position.Left} aria-label={`Enter ${node.label}`}/>} 
    <span>{nodeContract(node.kind).editor.icon}</span><strong>{node.label}</strong><small>{nodeContract(node.kind).editor.title} · {output.label}</small>
    {ports(node).map((port,index)=><Handle key={port} type="source" id={port} position={Position.Right} style={{top:`${ports(node).length===1?50:35+index*35}%`}} aria-label={`${node.label}: ${port}`}/>) }
  </div>;
}
const nodeTypes={inspection:InspectionNodeCard};

export function RunInspection({run,onSelectRun,onExport}:{run:Run;onSelectRun:(id:string)=>void;onExport:(run:Run)=>void}){
  const [selectedId,setSelectedId]=useState(run.definition.nodes.some(node=>node.id===run.cursor)?run.cursor:run.definition.nodes[0]?.id??'');
  const nodes=useMemo<InspectionNode[]>(()=>run.definition.nodes.map(node=>({id:node.id,type:'inspection',position:run.definition.layout[node.id]??{x:0,y:0},selected:node.id===selectedId,ariaLabel:graphNodeLabel(node,[],'inspect'),data:{node,output:inspectionOutput(run,node.id)}})),[run,selectedId]);
  const edges=useMemo<Edge[]>(()=>run.definition.edges.map(edge=>({...edge,sourceHandle:edge.port,label:edge.port==='next'?'':edge.port,ariaLabel:graphEdgeLabel(edge,run.definition.nodes,'inspect'),markerEnd:{type:MarkerType.ArrowClosed}})),[run]);
  const selected=run.definition.nodes.find(node=>node.id===selectedId)??run.definition.nodes[0];
  const output=selected?inspectionOutput(run,selected.id):{label:'No selected node'};
  return <section className="lp-executed-workflow" aria-label="Executed workflow">
    {run.parentRunId&&<div className="lp-run-parent"><span>Recovery run from <code>{run.parentRunId}</code></span><button onClick={()=>onSelectRun(run.parentRunId!)}>Inspect parent run</button></div>}
    <div className="lp-run-evidence"><span>Pinned execution evidence · {run.definition.name} · r{run.definition.revision}</span><button onClick={()=>onExport(run)}>Export run evidence</button></div>
    <ContextProvenance context={run.context}/>
    <details open><summary>Executed workflow (read-only)</summary><p className="lp-hint">This graph is the definition saved with this run. It does not edit or replace the current authoring draft.</p>
      <label className="lp-field"><span>Select executed node</span><select aria-label="Select executed node" value={selectedId} onChange={event=>setSelectedId(event.target.value)}>{run.definition.nodes.map(node=><option key={node.id} value={node.id}>{node.label} · {nodeContract(node.kind).editor.title}</option>)}</select></label>
      <div className="lp-executed-flow"><ReactFlow id={`loops-executed-${run.id}`} aria-label="Executed workflow. Select a node with Enter to inspect its pinned evidence." ariaLabelConfig={readOnlyGraphAriaLabelConfig} nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView nodesDraggable={false} nodesConnectable={false} nodesFocusable edgesFocusable elementsSelectable deleteKeyCode={null} onNodeClick={(_,node)=>setSelectedId(node.id)} onNodesChange={changes=>{const selected=selectionChange(changes);if(selected.selectedId)setSelectedId(selected.selectedId);}} onEdgesChange={()=>{}} proOptions={{hideAttribution:true}}><Background id={`loops-executed-background-${run.id}`}/><Controls showInteractive={false}/><MiniMap pannable zoomable/></ReactFlow></div>
      {selected&&<div className="lp-run-node-detail"><h3>{selected.label}</h3><p className="lp-muted">{nodeContract(selected.kind).editor.title} · {selected.id}</p><h4>Executed settings</h4><pre>{settings(selected)}</pre>{output.route&&<><h4>Selected route</h4><p className="lp-route"><code>{output.route.port}</code>{output.route.caseId&&<> · case {output.route.caseId}</>} · {output.route.available===false?<span>observed value unavailable</span>:<>observed <code>{output.route.observed}{output.route.truncated?'…':''}</code></>}</p></>}{output.checkpoint&&<><h4>{output.checkpoint.label}</h4><pre className="lp-checkpoint-output">{display(output.checkpoint.value)}</pre></>}<h4>{output.label}</h4>{output.value===undefined?<p className="lp-muted">No output is available for this node in this run.</p>:<pre className="lp-full-output">{display(output.value)}</pre>}</div>}
    </details>
  </section>;
}
