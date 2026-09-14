import type {Definition,GraphNode,Issue} from './graph.js';

type SelectionChange={id?:string;type:string;selected?:boolean};

export function selectionChange(changes:readonly SelectionChange[]){
  let changed=false,selectedId:string|undefined;
  for(const change of changes)if(change.type==='select'){changed=true;if(change.selected&&change.id)selectedId=change.id;}
  return {changed,selectedId};
}

export function graphNodeLabel(node:GraphNode,issues:readonly Issue[]=[],mode:'edit'|'inspect'='edit'){
  const problem=issues[0]?.message;
  return `${node.label}. ${node.kind} node.${problem?` Validation issue: ${problem}.`:''} Press Enter to select and ${mode==='edit'?'edit this node.':'inspect its pinned evidence.'}`;
}

export function graphEdgeLabel(edge:Definition['edges'][number],nodes:readonly GraphNode[],mode:'edit'|'inspect'='edit'){
  const source=nodes.find(node=>node.id===edge.source)?.label??edge.source;
  const target=nodes.find(node=>node.id===edge.target)?.label??edge.target;
  return `Connection from ${source}, ${edge.port} branch, to ${target}. ${mode==='edit'?'Press Enter to select and edit this connection.':'Read-only connection.'}`;
}

export function replaceConnection(definition:Definition,connection:Pick<Definition['edges'][number],'id'|'source'|'target'|'port'>):Definition{
  return {...definition,edges:[...definition.edges.filter(edge=>edge.id!==connection.id&&!(edge.source===connection.source&&edge.port===connection.port)),connection]};
}
