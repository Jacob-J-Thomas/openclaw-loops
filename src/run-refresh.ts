export type RunRefreshSelection={agentId:string;sessionKey:string;runId:string};
type Ticket={selection:RunRefreshSelection;epoch:number};

const same=(left:RunRefreshSelection|undefined,right:RunRefreshSelection)=>left?.agentId===right.agentId&&left.sessionKey===right.sessionKey&&left.runId===right.runId;

export class RunRefreshGate{
  private selection?:RunRefreshSelection;
  private epoch=0;
  private inFlight?:Ticket;
  private queued=false;
  select(selection:RunRefreshSelection){if(!same(this.selection,selection)){this.selection=selection;this.epoch++;this.queued=false;}}
  clear(){this.selection=undefined;this.epoch++;this.queued=false;}
  current(){return this.selection&&{selection:{...this.selection},epoch:this.epoch};}
  matches(ticket:Ticket|undefined){return Boolean(ticket&&this.accepts(ticket));}
  private begin(){
    if(!this.selection?.sessionKey||!this.selection.runId)return;
    if(this.inFlight&&same(this.inFlight.selection,this.selection)&&this.inFlight.epoch===this.epoch){this.queued=true;return;}
    const ticket={selection:{...this.selection},epoch:this.epoch};this.inFlight=ticket;return ticket;
  }
  private accepts(ticket:Ticket){return ticket.epoch===this.epoch&&same(this.selection,ticket.selection);}
  private finish(ticket:Ticket){
    if(this.inFlight!==ticket)return false;
    this.inFlight=undefined;const followUp=this.accepts(ticket)&&this.queued;this.queued=false;return followUp;
  }
  async refresh<T>(load:(selection:RunRefreshSelection)=>Promise<T>,receive:(value:T)=>void,fail:(error:unknown)=>void){
    const ticket=this.begin();if(!ticket)return;
    try{const value=await load(ticket.selection);if(this.accepts(ticket))receive(value);}catch(error){if(this.accepts(ticket))fail(error);}finally{if(this.finish(ticket))void this.refresh(load,receive,fail);}
  }
}
