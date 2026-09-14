import {describe,expect,it} from 'vitest';
import {captureRunControlFocus,runStateAnnouncement} from '../src/run-control-accessibility.js';

function focusedControl(){
  const document=Object.assign(new EventTarget(),{activeElement:{id:'shadow-host'},body:{}});
  const root:{activeElement:object|null}={activeElement:null};
  const origin={getRootNode:()=>root,ownerDocument:document} as unknown as HTMLElement;
  root.activeElement=origin;return {document,root,origin};
}

describe('run control accessibility',()=>{
  it('recognizes focus inside the host shadow root and releases its capture once',()=>{
    const {origin,root}=focusedControl(),release=captureRunControlFocus(origin);
    root.activeElement=null;expect(release()).toBe(true);expect(release()).toBe(false);
    expect(captureRunControlFocus(null)()).toBe(false);
  });

  it('does not steal focus after navigation, even when the new target later disappears',()=>{
    const {origin,document,root}=focusedControl(),release=captureRunControlFocus(origin);
    document.dispatchEvent(new Event('focusin'));root.activeElement=null;
    expect(release()).toBe(false);
  });

  it('ignores an action that did not own focus and preserves another focused control',()=>{
    const {origin,root}=focusedControl();root.activeElement={};expect(captureRunControlFocus(origin)()).toBe(false);
    root.activeElement=origin;const release=captureRunControlFocus(origin);root.activeElement={};expect(release()).toBe(false);
  });

  it('announces only the selected run state and pending cleanup',()=>{
    expect(runStateAnnouncement('completed')).toBe('Run state: completed.');
    expect(runStateAnnouncement('failed',true)).toBe('Run state: failed; cleanup is still in progress.');
  });
});
