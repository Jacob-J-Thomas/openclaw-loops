export type RunRefreshSelection={agentId:string;sessionKey:string;runId:string};
type Ticket={selection:RunRefreshSelection;epoch:number};

const same=(left:RunRefreshSelection|undefined,right:RunRefreshSelection)=>left?.agentId===right.agentId&&left.sessionKey===right.sessionKey&&left.runId===right.runId;

export class RunRefreshGate{
  private selection?:RunRefreshSelection;
  private epoch=0;
  private inFlight?:Ticket;
  private queued=false;
  private followUp?:()=>void;
  select(selection:RunRefreshSelection){if(!same(this.selection,selection)){this.selection=selection;this.invalidate();}}
  clear(){this.selection=undefined;this.invalidate();}
  /** Drops an obsolete inspection without revoking an in-flight action for this selection. */
  invalidateInspection(){this.inFlight=undefined;this.queued=false;this.followUp=undefined;}
  invalidate(){this.epoch++;this.invalidateInspection();}
  current(){return this.selection&&{selection:{...this.selection},epoch:this.epoch};}
  matches(ticket:Ticket|undefined){return Boolean(ticket&&this.accepts(ticket));}
  completeMutation(ticket:Ticket|undefined){if(!this.matches(ticket))return false;this.invalidate();return true;}
  private begin(){
    if(!this.selection?.sessionKey||!this.selection.runId)return;
    if(this.inFlight){this.queued=true;return;}
    const ticket={selection:{...this.selection},epoch:this.epoch};this.inFlight=ticket;return ticket;
  }
  private accepts(ticket:Ticket){return ticket.epoch===this.epoch&&same(this.selection,ticket.selection);}
  private finish(ticket:Ticket){
    if(this.inFlight!==ticket)return;
    this.inFlight=undefined;const followUp=this.selection&&this.queued?this.followUp:undefined;this.queued=false;this.followUp=undefined;return followUp;
  }
  async refresh<T>(load:(selection:RunRefreshSelection)=>Promise<T>,receive:(value:T)=>void,fail:(error:unknown)=>void){
    const ticket=this.begin();if(!ticket){this.followUp=()=>void this.refresh(load,receive,fail);return;}
    try{const value=await load(ticket.selection);if(this.inFlight===ticket&&this.accepts(ticket))receive(value);}catch(error){if(this.inFlight===ticket&&this.accepts(ticket))fail(error);}finally{this.finish(ticket)?.();}
  }
}
