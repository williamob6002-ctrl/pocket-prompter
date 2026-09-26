import {PROJECT_TYPES, buildProjectDraft, getProjectGuidance} from './project-builder.js';

const DRAFT_KEY='pocket-prompter-project-drafts-v1';

export function setupProjectBuilder({onUse,getWpm}){
  const $=selector=>document.querySelector(selector);
  const dialog=$('#project-dialog'),fields=$('#project-fields'),form=$('#project-form');
  let selected=PROJECT_TYPES[0].id,drafts={},preview=null;
  try{
    const saved=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');
    if(saved&&saved.drafts&&typeof saved.drafts==='object'&&!Array.isArray(saved.drafts)){
      for(const type of PROJECT_TYPES){
        const values=saved.drafts[type.id];
        if(values&&typeof values==='object')drafts[type.id]=Object.fromEntries(type.fields.map(field=>[field.id,typeof values[field.id]==='string'?values[field.id].slice(0,4000):'']));
      }
      if(PROJECT_TYPES.some(type=>type.id===saved.selected))selected=saved.selected;
    }
  }catch{}
  const state=document.createElement('p');state.className='hint';state.id='project-save-state';state.setAttribute('role','status');form.append(state);

  function remember(){
    drafts[selected]=Object.fromEntries([...fields.querySelectorAll('[data-project-field]')].map(input=>[input.dataset.projectField,input.value]));
    try{localStorage.setItem(DRAFT_KEY,JSON.stringify({selected,drafts}));state.textContent='Your ideas are saved on this device.';}
    catch{state.textContent='These ideas could not be saved. Use this script before closing the app.';}
  }
  function showFields(){
    preview=null;form.hidden=false;$('#project-result').hidden=true;
    fields.replaceChildren();
    const type=PROJECT_TYPES.find(type=>type.id===selected);
    for(const field of type.fields){
      const label=document.createElement('label');label.textContent=field.label+(field.required?'':' (optional)');
      const input=document.createElement(field.multiline?'textarea':'input');
      input.id=`project-${field.id}`;input.dataset.projectField=field.id;
      if(field.multiline)input.rows=3;else input.type='text';
      input.maxLength=4000;input.placeholder=field.placeholder;input.value=drafts[selected]?.[field.id]||'';input.required=!!field.required;
      label.htmlFor=input.id;label.append(input);fields.append(label);input.addEventListener('input',remember);
    }
    for(const button of $('#project-types').children)button.setAttribute('aria-pressed',String(button.dataset.type===selected));
    state.textContent='You can leave optional questions blank. Your draft stays editable.';
  }
  for(const type of PROJECT_TYPES){
    const button=document.createElement('button');button.type='button';button.dataset.type=type.id;
    const name=document.createElement('b');name.textContent=type.label;
    const description=document.createElement('span');description.textContent=type.description;
    button.append(name,description);button.onclick=()=>{remember();selected=type.id;showFields();remember();};
    $('#project-types').append(button);
  }
  showFields();
  $('#open-project-builder').onclick=()=>{dialog.showModal();};
  form.addEventListener('submit',event=>{
    event.preventDefault();remember();
    try{
      const missing=PROJECT_TYPES.find(type=>type.id===selected).fields.find(field=>field.required&&!drafts[selected]?.[field.id]?.trim());
      if(missing){state.textContent=`Add an answer for “${missing.label}” before previewing.`;$(`#project-${missing.id}`).focus();return;}
      preview=buildProjectDraft(selected,drafts[selected]);
      if(!preview.text.trim()){state.textContent='Add at least one idea before previewing your script.';fields.querySelector('input,textarea')?.focus();return;}
      $('#project-preview').value=preview.text;
      const guide=getProjectGuidance(preview.text,0,getWpm());
      $('#project-draft-stats').textContent=`${guide.wordCount} words · about ${Math.floor(guide.estimatedSeconds/60)}:${String(guide.estimatedSeconds%60).padStart(2,'0')} at your current pace`;
      form.hidden=true;$('#project-result').hidden=false;$('#use-project').disabled=false;
      $('#project-result').scrollIntoView({block:'start'});$('#project-preview').focus();
    }catch(error){state.textContent=error.message;}
  });
  $('#revise-project').onclick=()=>{form.hidden=false;$('#project-result').hidden=true;fields.querySelector('input,textarea')?.focus();};
  $('#use-project').onclick=()=>{
    if(!preview)return;
    $('#use-project').disabled=true;
    try{onUse(preview);dialog.close();showFields();}
    catch(error){state.textContent=error.message;$('#use-project').disabled=false;form.hidden=false;$('#project-result').hidden=true;}
  };
}
