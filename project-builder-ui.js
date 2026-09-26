import {PROJECT_TYPES, buildProjectDraft, getProjectGuidance} from './project-builder.js';

const DRAFT_KEY='pocket-prompter-project-drafts-v1';

export function setupProjectBuilder({onUse,getWpm}){
  const $=selector=>document.querySelector(selector);
  const dialog=$('#project-dialog'),fields=$('#project-fields'),form=$('#project-form'),types=$('#project-types');
  const buildButton=$('#build-project'),result=$('#project-result');
  let selected=PROJECT_TYPES[0].id,drafts={},preview=null,step=0,screen='types',renderedType=null;
  try{
    const saved=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');
    if(saved&&saved.drafts&&typeof saved.drafts==='object'&&!Array.isArray(saved.drafts)){
      for(const type of PROJECT_TYPES){
        const values=saved.drafts[type.id];
        if(values&&typeof values==='object')drafts[type.id]=Object.fromEntries(type.fields.map(field=>[field.id,typeof values[field.id]==='string'?values[field.id].slice(0,4000):'']));
      }
      if(PROJECT_TYPES.some(type=>type.id===saved.selected))selected=saved.selected;
      const length=PROJECT_TYPES.find(type=>type.id===selected).fields.length;
      if(Number.isInteger(saved.step)&&saved.step>=0&&saved.step<length)step=saved.step;
      if(saved.screen==='questions')screen='questions';
    }
  }catch{}
  // Native validation would try to focus required inputs on hidden steps.
  form.noValidate=true;
  const status=document.createElement('p');status.id='project-step-status';status.className='builder-step-status';status.setAttribute('aria-live','polite');
  const hint=document.createElement('p');hint.id='project-question-hint';hint.className='hint';
  form.insertBefore(status,fields);form.insertBefore(hint,fields);
  const nav=document.createElement('div');nav.className='builder-question-nav builder-actions';
  function button(id,text,className){const element=document.createElement('button');element.id=id;element.type='button';element.textContent=text;element.className=className;return element;}
  const back=button('project-back','Back','outline');
  const next=button('project-next','Next question','primary');
  const skip=button('project-skip','Skip this question','primary');
  const oldActions=buildButton.parentElement;
  nav.append(back,next,skip,buildButton);oldActions.replaceWith(nav);
  const state=document.createElement('p');state.className='hint';state.id='project-save-state';state.setAttribute('role','status');form.append(state);
  state.textContent='Your own words are enough. You can edit your script afterwards.';

  const currentType=()=>PROJECT_TYPES.find(type=>type.id===selected);
  function remember(){
    if(renderedType)drafts[renderedType]=Object.fromEntries([...fields.querySelectorAll('[data-project-field]')].map(input=>[input.dataset.projectField,input.value]));
    try{
      // Reloading a preview returns to the last question, with all notes intact.
      localStorage.setItem(DRAFT_KEY,JSON.stringify({selected,drafts,step,screen:screen==='preview'?'questions':screen}));
      state.textContent='Your ideas are saved on this device.';
    }catch{state.textContent='These ideas could not be saved. Use this script before closing the app.';}
  }
  function updateNavigation(){
    const type=currentType(),field=type.fields[step],last=step===type.fields.length-1;
    const empty=!$(`#project-${field.id}`).value.trim(),canSkip=!field.required&&empty;
    next.hidden=last||canSkip;skip.hidden=!canSkip;buildButton.hidden=!last||canSkip;
    skip.textContent=last?'Skip and preview':'Skip this question';
    back.textContent=step===0?'Choose a different project':'Back';
  }
  function makeFields(){
    fields.replaceChildren();renderedType=selected;
    for(const [index,field]of currentType().fields.entries()){
      const label=document.createElement('label');label.textContent=field.label+(field.required?'':' (optional)');label.dataset.projectStep=String(index);
      const input=document.createElement(field.multiline?'textarea':'input');
      input.id=`project-${field.id}`;input.dataset.projectField=field.id;
      if(field.multiline)input.rows=5;else input.type='text';
      input.maxLength=4000;input.placeholder=field.placeholder;input.value=drafts[selected]?.[field.id]||'';input.required=!!field.required;
      input.setAttribute('aria-describedby','project-question-hint project-save-state');
      label.htmlFor=input.id;label.append(input);fields.append(label);
      input.addEventListener('input',()=>{input.removeAttribute('aria-invalid');remember();updateNavigation();});
    }
  }
  function showScreen(focus=false){
    const type=currentType();
    types.hidden=screen!=='types';form.hidden=screen!=='questions';result.hidden=screen!=='preview';
    for(const choice of types.children)choice.setAttribute('aria-pressed',String(choice.dataset.type===selected));
    if(screen==='questions'){
      if(renderedType!==selected)makeFields();
      for(const label of fields.children)label.hidden=Number(label.dataset.projectStep)!==step;
      status.textContent=`${type.label} · Question ${step+1} of ${type.fields.length}`;
      hint.textContent=type.fields[step].required?'A few words or sentences are enough. Use what you know.':'This question is optional. Add an idea, or skip it.';
      updateNavigation();
      if(focus)$(`#project-${type.fields[step].id}`).focus({preventScroll:true});
    }else if(screen==='types'&&focus){types.querySelector('button')?.focus({preventScroll:true});}
    if(focus)dialog.scrollTop=0;
  }
  function validate(index){
    const field=currentType().fields[index],input=$(`#project-${field.id}`);
    if(!field.required||input.value.trim())return true;
    step=index;screen='questions';showScreen(true);remember();
    input.setAttribute('aria-invalid','true');state.textContent=`Add an answer for “${field.label}” before continuing.`;
    return false;
  }
  function forward(){
    if(!validate(step))return;
    if(step===currentType().fields.length-1){form.requestSubmit(buildButton);return;}
    step++;preview=null;showScreen(true);remember();
  }
  back.onclick=()=>{remember();preview=null;if(step===0)screen='types';else step--;showScreen(true);remember();};
  next.onclick=forward;skip.onclick=forward;
  for(const type of PROJECT_TYPES){
    const choice=document.createElement('button');choice.type='button';choice.dataset.type=type.id;
    const name=document.createElement('b');name.textContent=type.label;
    const description=document.createElement('span');description.textContent=type.description;
    choice.append(name,description);choice.onclick=()=>{remember();selected=type.id;step=0;screen='questions';preview=null;makeFields();showScreen(true);remember();};
    types.append(choice);
  }
  makeFields();showScreen();
  $('#open-project-builder').onclick=()=>{const start=$('#start-dialog');if(start?.open)start.close();dialog.showModal();showScreen(true);};
  // Close and Escape keep the current question; input events also save notes.
  dialog.addEventListener('close',remember);
  form.addEventListener('submit',event=>{
    event.preventDefault();
    // Enter on an early single-line answer moves one question forward.
    if(step<currentType().fields.length-1){forward();return;}
    remember();
    for(let index=0;index<currentType().fields.length;index++)if(!validate(index))return;
    try{
      preview=buildProjectDraft(selected,drafts[selected]);
      if(!preview.text.trim()){step=0;showScreen(true);state.textContent='Add at least one idea before previewing your script.';return;}
      $('#project-preview').value=preview.text;
      const guide=getProjectGuidance(preview.text,0,getWpm());
      $('#project-draft-stats').textContent=`${guide.wordCount} words · about ${Math.floor(guide.estimatedSeconds/60)}:${String(guide.estimatedSeconds%60).padStart(2,'0')} at your current pace`;
      screen='preview';showScreen();remember();$('#use-project').disabled=false;
      dialog.scrollTop=0;$('#project-preview').focus({preventScroll:true});
    }catch(error){state.textContent=error.message;}
  });
  $('#revise-project').onclick=()=>{screen='questions';showScreen(true);remember();};
  $('#use-project').onclick=()=>{
    if(!preview)return;
    $('#use-project').disabled=true;
    try{onUse(preview);preview=null;screen='types';step=0;remember();dialog.close();showScreen();}
    catch(error){$('#use-project').disabled=false;screen='questions';showScreen();state.textContent=error.message;}
  };
}
