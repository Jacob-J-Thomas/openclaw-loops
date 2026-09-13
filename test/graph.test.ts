import {describe,expect,it,vi} from 'vitest';
import {bind,compare,parseDefinition,validateGraph,type Definition,type GraphNode,type Json,type Predicate} from '../src/graph.js';
import {Engine,type Actor,type HostCapabilities,type Storage} from '../src/engine.js';

// Golden cases distinguish the documented v1 coercion contract from v2 types.
// Values enter through bindings so JSON values are not confused with text literals.
const comparisons:Array<[string,Predicate['op'],Json,Json,boolean,boolean]>=[
  ['numeric equality','equals',0,0,true,true],
  ['numeric string is a different type','equals',0,'0',true,false],
  ['null equality','equals',null,null,true,true],
  ['object order is irrelevant in v2','equals',{a:0,b:false},{b:false,a:0},false,true],
  ['nested values differ','equals',{a:[null,0]},{a:[null,'0']},false,false],
  ['array order matters','equals',[1,2],[2,1],false,false],
  ['typed inequality','not-equals',false,'false',false,true],
  ['equal values are not unequal','not-equals',{x:1},{x:1},false,false],
  ['substring','contains','A🙂B','🙂',true,true],
  ['case is significant','contains','Alpha','alpha',false,false],
  ['empty substring','contains','text','',true,true],
  ['array values are typed','contains',[10],1,true,false],
  ['array object containment','contains',[{x:0,y:false}],{y:false,x:0},false,true],
  ['empty array has no null','contains',[],null,false,false],
  ['less than zero','less-than',-1,0,true,true],
  ['numeric text remains text in v2','less-than','2','10',true,false],
  ['empty text is not a v2 number','less-than','',1,true,false],
  ['null is not a v2 number','less-than',null,1,true,false],
  ['equal numbers are not less','less-than',0,0,false,false],
  ['unparseable legacy number','less-than','no',1,false,false],
  ['greater than negative','greater-than',0,-1,true,true],
  ['legacy boolean coercion','greater-than',true,0,true,false],
  ['equal numbers are not greater','greater-than',1,1,false,false],
];
describe('predicate value contracts',()=>{
  it.each(comparisons)('%s',(_label,op,left,right,v1,v2)=>{
    const predicate={left:'{{input.left}}',op,right:'{{input.right}}'},context={input:{left,right},nodes:{}};
    expect(compare(predicate,context,1)).toBe(v1);expect(compare(predicate,context,2)).toBe(v2);
  });
  it.each([true,'true',false,'false',0,1,'',null,[],{}] as Json[])('truthy has an explicit contract for %j and ignores its right operand',left=>{
    for(const version of [1,2] as const)for(const right of ['{{input.absent}}','{{nodes.never.value}}','{{unclosed'])
      expect(compare({left:'{{input.left}}',op:'truthy',right},{input:{left},nodes:{}},version)).toBe(left===true||left==='true');
  });
  it.each(['equals','not-equals','contains','less-than','greater-than'] as const)('%s fails on an absent operand instead of treating it as null or false',op=>{
    const inputs:Array<Record<string,Json>>=[{left:null},{right:null}];
    for(const version of [1,2] as const)for(const input of inputs)
      expect(()=>compare({left:'{{input.left}}',op,right:'{{input.right}}'},{input,nodes:{}},version)).toThrow(expect.objectContaining({detail:expect.objectContaining({code:'LOOPS_BINDING_UNAVAILABLE'})}));
  });
  it('preserves nested zero, false, empty text and null and rejects unsafe or absent traversal',()=>{
    const context={input:{data:{rows:[{zero:0,no:false,empty:'',nil:null}],text:'🙂'}},nodes:{}};
    expect(bind('{{input.data.rows.0}}',context)).toEqual({zero:0,no:false,empty:'',nil:null});
    expect(bind('{{input.data.rows.0.zero}}',context)).toBe(0);expect(bind('{{input.data.rows.0.no}}',context)).toBe(false);expect(bind('{{input.data.rows.0.empty}}',context)).toBe('');expect(bind('{{input.data.rows.0.nil}}',context)).toBeNull();
    expect(bind('Values: {{input.data.rows.0.zero}}/{{input.data.rows.0.no}}/{{input.data.rows.0.nil}}',context)).toBe('Values: 0/false/null');
    for(const path of ['rows.1','absent','rows.0.nil.value','text.toString','constructor','rows.__proto__','rows.0.prototype'])expect(()=>bind(`{{input.data.${path}}}`,context)).toThrow('Binding unavailable');
  });
});

const input:GraphNode={id:'input',kind:'input',label:'Input'},end:GraphNode={id:'end',kind:'return',label:'Result',value:'ok'};
const inference:Extract<GraphNode,{kind:'inference'}>={id:'producer',kind:'inference',label:'Inference',prompt:'Produce JSON.',output:'text'};
const check:Extract<GraphNode,{kind:'condition'}>={id:'producer',kind:'condition',label:'Condition',predicate:{left:'true',op:'truthy',right:''}};
const repeat:Extract<GraphNode,{kind:'repeat'}>={id:'producer',kind:'repeat',label:'Repeat',maxIterations:2,body:[{...inference,id:'draft',output:'json'},{...check,id:'check',predicate:{left:'{{nodes.draft.value.ok}}',op:'truthy',right:'{{unused'}}]};
function definition(producer:GraphNode=input):Definition{
  const nodes=producer.kind==='input'?[input,end]:[input,producer,end];
  const outgoing=producer.kind==='condition'?['true','false'] as const:producer.kind==='review'?['approve','reject'] as const:['next'] as const;
  return {schemaVersion:2,id:'binding-contract',slug:'binding-contract',name:'Binding contract',description:'',revision:0,inputSchema:[{name:'left',label:'Left',type:'json',required:false},{name:'right',label:'Right',type:'json',required:false}],nodes:structuredClone(nodes),
    edges:[...producer.kind==='input'?[]:[{id:'entry',source:'input',target:producer.id,port:'next' as const}],...outgoing.map(port=>({id:'edge-'+port,source:producer.id,target:'end',port}))],layout:{},capabilities:['llm','model-info'],limits:{maxExecutions:1000,timeoutMs:10000,maxOutputBytes:1048576}};
}
const inferenceFields=['text','provider','model','agentId','usage','execution','audit','settings'];
const producers:Array<[string,GraphNode,string[]]>=[
  ['Input',input,['fields']],['text Inference',inference,inferenceFields],['JSON Inference',{...inference,output:'json'},[...inferenceFields,'value']],
  ['Action',{id:'producer',kind:'action',label:'Model',capability:'model-info'},['provider','model','agentId']],['Condition',check,['value']],
  ['JSON Repeat',repeat,[...inferenceFields,'value','succeeded','iterations','exhausted']],
  ['text Repeat',{...repeat,body:[{...repeat.body[0],output:'text'},{...repeat.body[1],predicate:{left:'true',op:'truthy',right:''}}]},[...inferenceFields,'succeeded','iterations','exhausted']],['Wait',{id:'producer',kind:'wait',label:'Wait',message:'Continue'},[]],
  ['Human review',{id:'producer',kind:'review',label:'Review',proposal:'Approve'},['decision']],
];
describe('producer and path validation',()=>{
  it.each(producers)('%s accepts its declared output fields and rejects a field it cannot produce',(_name,producer,fields)=>{
    for(const field of new Set(['invented',...producers.flatMap(row=>row[2])])){
      const d=definition(producer),last=d.nodes.at(-1)!;if(last.kind!=='return')throw Error();last.value=`{{nodes.${producer.id}.${field}}}`;
      parseDefinition(d);const issues=validateGraph(d);if(!fields.includes(field))expect(issues).toContainEqual({nodeId:'end',message:`Node ${producer.id} (${producer.kind}) does not produce ${field}.`});else expect(issues).toEqual([]);
    }
  });
  it.each(['return','fail'] as const)('%s cannot be used as a producer for a later node',kind=>{
    const d=definition(kind==='return'?{id:'producer',kind,label:'Return',value:'ok'}:{id:'producer',kind,label:'Fail',reason:'stop'});const last=d.nodes.at(-1)!;if(last.kind!=='return')throw Error();last.value='{{nodes.producer.value}}';
    expect(validateGraph(d)).toContainEqual({nodeId:'producer',message:'Unexpected outgoing port.'});expect(validateGraph(d)).toContainEqual({nodeId:'end',message:`Node producer (${kind}) does not produce value.`});
  });
  it('rejects branch-specific producer values at a join until every branch visits that producer',()=>{
    const d=definition({...check,id:'branch'});d.nodes.splice(2,0,inference);d.edges.find(e=>e.port==='true')!.target='producer';d.edges.push({id:'after-producer',source:'producer',target:'end',port:'next'});const last=d.nodes.at(-1)!;if(last.kind!=='return')throw Error();last.value='{{nodes.producer.text}}';
    expect(validateGraph(d)).toContainEqual({nodeId:'end',message:'Binding producer is not guaranteed to have executed.'});d.edges.find(e=>e.port==='false')!.target='producer';expect(validateGraph(d)).toEqual([]);
  });
  it('limits Repeat bindings to its index, preceding inference and public parent output',()=>{
    const d=definition(repeat),node=d.nodes[1];if(node.kind!=='repeat')throw Error();node.body[0].prompt='Iteration {{repeat.index}}';expect(validateGraph(d)).toEqual([]);
    node.body[0].prompt='{{nodes.check.value}}';expect(validateGraph(d)).toContainEqual({nodeId:'producer',message:'Binding check is not guaranteed to have executed.'});node.body[0].prompt='ok';
    const last=d.nodes.at(-1)!;if(last.kind!=='return')throw Error();last.value='{{nodes.draft.value}}';expect(validateGraph(d)).toContainEqual({nodeId:'end',message:'Binding draft is not guaranteed to have executed.'});last.value='{{nodes.producer.value.ok}}';expect(validateGraph(d)).toEqual([]);
    last.value='{{repeat.index}}';expect(validateGraph(d)).toContainEqual({nodeId:'end',message:'repeat.index is only available inside Repeat.'});
  });
  it.each(['{{input.left.constructor}}','{{input.left.__proto__}}','{{input.left.prototype}}','{{input.left[0]}}','{{input.left','{{input.left}} {{not-a-root}}'])('rejects malformed or unsafe graph binding %s',value=>{
    const d=definition();const last=d.nodes.at(-1)!;if(last.kind!=='return')throw Error();last.value=value;expect(validateGraph(d).length).toBeGreaterThan(0);
  });
});

describe('committed condition execution',()=>{
  it.each([1,2] as const)('selects the actual branch, ignores malformed truthy right text and fails missing values in v%s',async schemaVersion=>{
    const actor:Actor={agentId:'test',sessionKey:'agent:test:bindings',sessionId:'bindings',source:'tool',human:false,check:()=>{}};
    let state:ReturnType<Storage['read']>;const storage:Storage={read:()=>structuredClone(state),write:value=>{state=structuredClone(value);}};
    const host:HostCapabilities={check:()=>{},complete:vi.fn(async()=>({text:'unused'})),modelInfo:vi.fn(async()=>({provider:'unused',model:'unused'}))};const engine=new Engine(storage,host);
    try{
      const d=definition(check);d.schemaVersion=schemaVersion;d.inputSchema=[{name:'left',label:'Left',type:'boolean',required:true},{name:'right',label:'Right',type:'boolean',required:false}];d.capabilities=[];
      const condition=d.nodes[1];if(condition.kind!=='condition')throw Error();condition.predicate={left:'{{input.left}}',op:'truthy',right:'{{nodes.never.value'};
      d.nodes.push({id:'otherwise',kind:'return',label:'Otherwise',value:'false branch'});d.edges.find(edge=>edge.port==='false')!.target='otherwise';expect(validateGraph(d)).toEqual([]);
      const yes=await engine.test(actor,d,{left:true},'yes'),no=await engine.test(actor,d,{left:false},'no');expect(yes.result).toBe('ok');expect(no.result).toBe('false branch');expect(yes.state).toBe('completed');expect(no.state).toBe('completed');
      condition.predicate={left:'{{input.left}}',op:'equals',right:'{{input.right}}'};const missing=await engine.test(actor,d,{left:true},'missing');expect(missing.state).toBe('failed');expect(missing.result).toBeUndefined();expect(missing.errorDetail).toMatchObject({code:'LOOPS_BINDING_UNAVAILABLE',nodeId:'producer'});expect(missing.trace.some(step=>['end','otherwise'].includes(step.nodeId))).toBe(false);
      expect(host.complete).not.toHaveBeenCalled();expect(host.modelInfo).not.toHaveBeenCalled();
    }finally{await engine.close();}
  });
});
