import {describe,expect,it} from 'vitest';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ContextEditor,contextDefault,contextPathIssue,type ContextConfigurable} from '../src/context-editor.js';

const render=(node:ContextConfigurable)=>renderToStaticMarkup(React.createElement(ContextEditor,{node,onChange:()=>{},heading:'Shared context for Return'}));

describe('context editor',()=>{
  it('starts opt-in and distinguishes removing configuration from omitting a projection or patch',()=>{
    expect(render({})).toContain('Configure context');
    const html=render({context:contextDefault()});
    expect(html).toContain('Remove context configuration');
    expect(html).toContain('Do not expose context to this node');
    expect(html).toContain('Do not change context');
  });
  it('renders accessible controls for every projection, patch, and typed literal choice',()=>{
    const html=render({context:{version:1,projection:{mode:'consume',paths:['/input/items/2','/a~1b']},patch:{mode:'replace',target:'/answer',source:{kind:'literal',value:{literalJson:'0'}}}}});
    for(const label of ['Context projection','Projected path 1','Projected path 2','Output patch','Context target JSON Pointer','Patch source','Literal patch value'])expect(html).toContain(label);
    expect(html).toContain('JSON value');expect(html).toContain('>0</textarea>');expect(html).toContain('Shared context for Return');
  });
  it('keeps an empty consume selection visible as an immediately repairable authoring error',()=>{
    const html=render({context:{version:1,projection:{mode:'consume',paths:[]},patch:{mode:'omit'}}});
    expect(html).toContain('Choose at least one context path.');expect(html).toContain('role="status"');
  });
  it('accepts RFC 6901 escapes and array positions while surfacing only invalid or immutable paths immediately',()=>{
    expect(contextPathIssue('/input/items/2')).toBeUndefined();
    expect(contextPathIssue('/a~1b/~0name')).toBeUndefined();
    expect(contextPathIssue('/input',{mutable:true})).toMatch(/immutable/);
    expect(contextPathIssue('/bad~2path')).toMatch(/~0/);
    expect(contextPathIssue('/__proto__/x')).toMatch(/protected/);
  });
});
