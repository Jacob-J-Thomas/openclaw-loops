export function captureRunControlFocus(origin?:HTMLElement|null){
  if(!origin)return ()=>false;
  const root=origin.getRootNode() as Document|ShadowRoot,document=origin.ownerDocument;
  if(root.activeElement!==origin)return ()=>false;
  let moved=false,released=false;
  const onFocus=(event:Event)=>{if(!event.composedPath().includes(origin))moved=true;};
  document.addEventListener('focusin',onFocus,true);
  return ()=>{
    if(released)return false;
    released=true;document.removeEventListener('focusin',onFocus,true);
    return !moved&&(root.activeElement===origin||root.activeElement===null||root.activeElement===document.body);
  };
}

export function runStateAnnouncement(state:string,cleanupPending=false){
  return `Run state: ${state}${cleanupPending?'; cleanup is still in progress':''}.`;
}
