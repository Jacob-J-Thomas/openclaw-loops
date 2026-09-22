import React from 'react';
import { createRoot } from 'react-dom/client';
import { defineControlUiPlugin } from 'openclaw/plugin-sdk/control-ui';
import { Editor } from './editor.js';
import { styles } from './styles.generated.js';
export default defineControlUiPlugin({id:'loops-poc',activate(host){
  const page=host.ui.registerPage({id:'loops',label:'Loops',mount(container){
    const shadow=container.shadowRoot??container.attachShadow({mode:'open'});shadow.replaceChildren();const style=document.createElement('style');style.textContent=styles;const app=document.createElement('div');shadow.append(style,app);
    const root=createRoot(app);root.render(<Editor host={host}/>);
    return {dispose:()=>root.unmount()};
  }});const nav=host.ui.registerNavigation({id:'loops',label:'Loops',page:{id:'loops'},icon:'repeat',order:5});return()=>{nav();page();};
}});
