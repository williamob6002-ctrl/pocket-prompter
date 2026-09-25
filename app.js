import {saveTake, saveChunk, listTakes, takeBlob, deleteTake, updateTakeMetadata} from './storage.js';
import {processVideo, toSrt, parseSrt, trimCaptions, getVideoProcessingSupport} from './video-processing.js';
import {VoiceFollower} from './voice-follow.js';
import {exportAudio} from './audio-export.js';
import {AudioMonitor} from './audio-monitor.js';
import {setupAutomaticCaptions} from './automatic-captions.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const STORE = 'pocket-prompter-v1';
const defaults = {wpm:130,fontSize:40,lineHeight:1.6,width:90,font:'system',align:'left',theme:'dark',guide:true,mirrorX:false,mirrorY:false,countdown:3,finishDelay:0,frameRate:30,pauseOnSilence:false,silenceThreshold:-42,silenceDelay:1200,loop:false,keepAwake:true,voice:false,language:'en-GB',facing:'user',quality:'1080',panelHeight:60,opacity:70};
const sample = `Hello! Today I’m going to explain the water cycle.\n\nThe water on our planet is always moving. It travels between the sea, the sky and the land. This journey is called the **water cycle**.\n\nFirst, the sun warms the water in rivers, lakes and oceans. Some of that water turns into water vapour and rises into the air. This is called ==evaporation==.\n\nHigh in the sky, the air is cooler. The water vapour turns into tiny droplets that gather together to form clouds. This is called condensation.\n\nWhen the droplets get heavy enough, they fall as rain, snow or hail. We call this precipitation.\n\nThe water collects in rivers and oceans, and the whole journey begins again.\n\nThank you for listening!`;
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const wordCount = text => (plainText(text).match(/\S+/gu)||[]).length;
const plainText = text => text.replace(/\*\*|==/g,'');
const clock = seconds => `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const fileName = name => (name.replace(/[^\p{L}\p{N} _-]/gu,'').trim() || 'My script').slice(0,100);
const wait = ms => new Promise(r=>setTimeout(r,ms));
let data, storageError, activeView='scripts', toastTimer;
try { const stored=localStorage.getItem(STORE); data=stored ? JSON.parse(stored) : null; if(data && (!Array.isArray(data.scripts)||data.scripts.some(s=>typeof s.text!=='string'||typeof s.title!=='string'||typeof s.id!=='string'))) throw new Error('Unrecognised script data'); }
catch(e) { storageError=e; data=null; }
if(!data) {const id=uid();data={version:1,activeId:id,settings:{...defaults},scripts:[{id,title:'The water cycle',text:sample,updated:Date.now()}]};}
data.settings={...defaults,...data.settings};
let settings=data.settings;
let current=data.scripts.find(s=>s.id===data.activeId)||data.scripts[0];
if(!current){current={id:uid(),title:'My first script',text:'',updated:Date.now()};data.scripts.push(current);data.activeId=current.id;}
let readerOpen=false,cameraMode=false,playing=false,pendingStart=false,countdownToken=0;
let stream=null,recorder=null,recordInfo=null,chunkQueue=Promise.resolve(),recordChunks=[],recordStorageError=null,chunkIndex=0;
let recordingStarting=false,recordSegmentActive=false;
function accumulateRecording(){if(recordSegmentActive){recordAccum+=(performance.now()-recordStarted)/1000;recordSegmentActive=false;}}
let stopPromise=null,resolveStop=null,recordStarted=0,recordAccum=0,sessionElapsed=0,lastFrame=0,scrollPosition=0,wakeLock=null,voiceFollower=null;
let selectedTake=null,selectedBlob=null,takeURL=null,cameraRequest=0,captionDirty=false,trimEndEdited=false;
let exportController=null,previewTrimEnd=null,finishAt=0,audioExportBusy=false;
let soundDetected=false,monitorReady=false;
function setTextIfChanged(selector,text){const element=$(selector);if(element.textContent!==text)element.textContent=text;}
const audioMonitor=new AudioMonitor({
  onLevel:({db,level,speaking})=>{
    soundDetected=speaking;monitorReady=true;$('#mic-level').value=level;
    setTextIfChanged('#mic-reading',db>-3?'Too loud':speaking?'Sound detected':'Quiet');
    if(cameraMode&&settings.pauseOnSilence&&playing)setTextIfChanged('#session-status',recorder?.state==='recording'?(speaking?'● Recording':'● Recording · words waiting for sound'):(speaking?'Reading':'Words waiting for sound'));
  },
  onError:error=>{
    monitorReady=false;soundDetected=false;$('#mic-reading').textContent='Meter unavailable';
    if(cameraMode&&settings.pauseOnSilence&&playing){playing=false;updateButtons();$('#session-status').textContent=recorder?.state==='recording'?'● Recording · words paused':'Words paused';toast(error.message);}
  }
});

function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4200);}
function message(title,body){$('#message-title').textContent=title;$('#message-body').textContent=body;$('#message-dialog').showModal();}
function save(){
  if(storageError){$('#save-state').textContent='Storage needs attention — back up scripts';return false;}
  try{localStorage.setItem(STORE,JSON.stringify(data));$('#save-state').textContent='Saved on this device';return true;}
  catch(e){$('#save-state').textContent='Not saved — device storage is full or unavailable';return false;}
}
function stats(){const words=wordCount(current.text);$('#script-stats').textContent=`${words} words · about ${clock(words/settings.wpm*60)}`;$('#read-script').disabled=!words;$('#record-script').disabled=!words;}
function renderLibrary(){
  const list=$('#script-list');list.replaceChildren();
  const query=$('#search').value.toLowerCase();
  const matches=data.scripts.filter(s=>`${s.title} ${s.text}`.toLowerCase().includes(query)).sort((a,b)=>b.updated-a.updated);
  for(const script of matches){const button=document.createElement('button');button.className='script-card';button.setAttribute('aria-pressed',String(current.id===script.id));const title=document.createElement('b');title.textContent=script.title||'Untitled script';const sub=document.createElement('span');sub.textContent=`${wordCount(script.text)} words`;button.append(title,sub);button.onclick=()=>selectScript(script.id);list.append(button);}
  if(!matches.length){const p=document.createElement('p');p.className='hint';p.textContent='No matching scripts.';list.append(p);}
}
function selectScript(id){current=data.scripts.find(s=>s.id===id);data.activeId=id;$('#script-title').value=current.title;$('#script-text').value=current.text;stats();renderLibrary();save();}
function newScript(title='Untitled script',text=''){const script={id:uid(),title,text,updated:Date.now()};data.scripts.unshift(script);$('#search').value='';selectScript(script.id);showView('scripts');if(!text)$('#script-title').focus();return script;}
async function showView(view){activeView=view;for(const section of $$('.view'))section.hidden=section.id!==`${view}-view`;for(const b of $$('.bottom-nav button')){if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}if(view==='takes')await renderTakes();window.scrollTo(0,0);}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function shareFile(blob,name,title){const file=new File([blob],name,{type:blob.type});if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title});return true;}download(blob,name);return false;}

$('#new-script').onclick=()=>newScript();
$('#search').oninput=renderLibrary;
$('#script-title').oninput=e=>{current.title=e.target.value;current.updated=Date.now();save();renderLibrary();};
$('#script-text').oninput=e=>{current.text=e.target.value;current.updated=Date.now();save();stats();renderLibrary();};
for(const button of $$('.bottom-nav button'))button.onclick=()=>showView(button.dataset.view);
$('#script-menu').onclick=()=>$('#actions-dialog').showModal();
$('#duplicate-script').onclick=()=>{$('#actions-dialog').close();newScript(`${current.title} (copy)`,current.text);toast('Copy created');};
$('#export-script').onclick=()=>download(new Blob([plainText(current.text)],{type:'text/plain;charset=utf-8'}),`${fileName(current.title)}.txt`);
$('#share-script').onclick=async()=>{try{await shareFile(new Blob([plainText(current.text)],{type:'text/plain'}),`${fileName(current.title)}.txt`,current.title);}catch(e){if(e.name!=='AbortError')message('Could not share',e.message);}};
$('#delete-script').onclick=()=>{if(!confirm(`Delete “${current.title||'Untitled script'}”? This cannot be undone.`))return;data.scripts=data.scripts.filter(s=>s.id!==current.id);$('#actions-dialog').close();if(!data.scripts.length)newScript();else selectScript(data.scripts[0].id);toast('Script deleted');};
$('#format-help').onclick=()=>message('Emphasise the important words','Wrap words in **double asterisks** for bold, or ==double equals== for a yellow highlight. Paragraph breaks give your words breathing space. Formatting marks are hidden when reading.');
$('#share-app').onclick=async()=>{const url=new URL('./',location.href).href;try{if(navigator.share)await navigator.share({title:'Pocket Prompter',text:'Free teleprompter: read, record and share. Open in Safari, then Add to Home Screen.',url});else if(navigator.clipboard){await navigator.clipboard.writeText(url);toast('App link copied');}else message('Share this link',url);}catch(e){if(e.name!=='AbortError')message('Share this link',url);}};
$('#backup-scripts').onclick=()=>download(new Blob([JSON.stringify({app:'pocket-prompter',version:1,exportedAt:new Date().toISOString(),scripts:data.scripts,settings},null,2)],{type:'application/json'}),`Pocket-Prompter-backup-${new Date().toISOString().slice(0,10)}.json`);
$('#restore-scripts').onclick=()=>{$('#import-file').accept='.json';$('#import-file').click();};
$('#import-script').onclick=()=>{$('#import-file').accept='.txt,.md,.doc,.docx,.pdf,.rtf,.gdoc,.json';$('#import-file').click();};
$('#import-file').onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;e.target.value='';$('#import-script').disabled=true;
  try{
    if(file.name.toLowerCase().endsWith('.json')){
      if(file.size>20*1024*1024)throw new Error('This backup is too large. Choose a Pocket Prompter backup under 20 MB.');
      const backup=JSON.parse(await file.text());
      if(backup.app!=='pocket-prompter'||backup.version!==1||!Array.isArray(backup.scripts)||backup.scripts.length>1000||backup.scripts.some(s=>typeof s.title!=='string'||typeof s.text!=='string'||s.text.length>500000))throw new Error('Choose a valid Pocket Prompter script backup.');
      let count=0;for(const s of backup.scripts){if(data.scripts.some(old=>old.title===s.title&&old.text===s.text))continue;data.scripts.push({id:uid(),title:s.title.slice(0,160),text:s.text,updated:Date.now()});count++;}
      if(backup.settings && typeof backup.settings==='object'){for(const key of Object.keys(defaults)){if(typeof backup.settings[key]===typeof defaults[key])settings[key]=backup.settings[key];}normaliseSettings();}
      const persisted=save();renderLibrary();stats();if(persisted)toast(`${count} scripts restored. Existing scripts kept.`);else message('Restored for this session only','Device storage could not save the restored scripts. Back them up now before closing the app. Existing saved scripts have not been replaced.');return;
    }
    toast('Opening your document…');const {importScriptFile}=await import('./import-module/import-script.mjs');const imported=await importScriptFile(file);newScript(imported.title,imported.text);toast('Script imported');
  }catch(error){message('Could not import',error.message||'The file could not be opened. Try saving it as a text file.');}
  finally{$('#import-script').disabled=false;}
};

function normaliseSettings(){
  const ranges={wpm:[40,300],fontSize:[24,88],lineHeight:[1.35,2.2],width:[45,100],countdown:[0,10],finishDelay:[0,10],frameRate:[24,60],silenceThreshold:[-65,-15],silenceDelay:[500,2500],panelHeight:[45,80],opacity:[20,95]};
  for(const [key,[min,max]]of Object.entries(ranges)){const number=Number(settings[key]);settings[key]=Math.min(max,Math.max(min,Number.isFinite(number)?number:defaults[key]));}
  const choices={font:['system','serif','mono'],align:['left','center','right'],theme:['dark','light','yellow','blue'],facing:['user','environment'],quality:['720','1080','2160'],language:['en-GB','en-US','es-ES','fr-FR','de-DE','it-IT']};
  if(![24,25,30,60].includes(settings.frameRate))settings.frameRate=30;
  for(const[key,values]of Object.entries(choices))if(!values.includes(settings[key]))settings[key]=defaults[key];
}
normaliseSettings();
function applySettings(){
  const r=$('#reader');const themes={dark:['#ffffff','#000000'],light:['#111827','#ffffff'],yellow:['#ffe66e','#000000'],blue:['#ffffff','#163b83']};const [fg,bg]=themes[settings.theme];
  r.style.setProperty('--prompt-color',fg);r.style.setProperty('--prompt-bg',bg);r.style.setProperty('--camera-prompt-bg',`${bg}${Math.round(settings.opacity/100*255).toString(16).padStart(2,'0')}`);
  r.style.setProperty('--prompt-size',`${settings.fontSize}px`);r.style.setProperty('--prompt-line',settings.lineHeight);r.style.setProperty('--prompt-width',`${settings.width}%`);r.style.setProperty('--prompt-align',settings.align);r.style.setProperty('--mirror-x',settings.mirrorX?-1:1);r.style.setProperty('--mirror-y',settings.mirrorY?-1:1);r.style.setProperty('--panel-height',`${settings.panelHeight}%`);
  $('#prompt-text').style.fontFamily={system:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',serif:'Georgia,serif',mono:'ui-monospace,Menlo,monospace'}[settings.font];
  $('#reading-guide').hidden=!settings.guide;$('#reading-guide').style.top=settings.mirrorY?'calc(76% - var(--prompt-size) * var(--prompt-line))':'24%';$('#speed-label').textContent=settings.wpm;$('#quick-speed').value=settings.wpm;
  for(const input of $$('[data-setting]')){const value=settings[input.dataset.setting];if(input.type==='checkbox')input.checked=value;else input.value=String(value);}
  $('#silence-threshold-output').textContent=`${settings.silenceThreshold} dB`;
  $('[data-setting="pauseOnSilence"]').disabled=!cameraMode||!AudioMonitor.supported();
  $('#mic-monitor').hidden=!cameraMode;
  $('#font-size-output').textContent=`${settings.fontSize}px`;$('#width-output').textContent=`${settings.width}%`;$('#camera-preview').style.transform=settings.facing==='user'?'scaleX(-1)':'';
  const height=$('#prompt-scroll').clientHeight;$('#prompt-text').style.setProperty('--lead-in',`${height*.24}px`);$('#prompt-text').style.setProperty('--lead-out',`${height*.76}px`);
  const supported=!!(window.SpeechRecognition||window.webkitSpeechRecognition);$('[data-setting="voice"]').disabled=!supported||cameraMode;
  if(!supported)$('#voice-help').textContent='Voice following is unavailable in this browser. Fixed-speed reading works offline.';
  else if(cameraMode)$('#voice-help').textContent='Voice following is available in practice mode. Recording can use fixed-speed or pause-on-silence scrolling without the speech service.';
  else $('#voice-help').textContent='Experimental. Uses your browser’s speech service, which may send audio to its provider and require internet. Fixed-speed reading is fully offline.';
  for(const key of ['facing','quality','frameRate'])$(`[data-setting="${key}"]`).disabled=recordingStarting||!!recorder&&recorder.state!=='inactive';
}
for(const input of $$('[data-setting]'))input.oninput=async()=>{
  const key=input.dataset.setting;const oldFraction=progress();
  settings[key]=input.type==='checkbox'?input.checked:typeof defaults[key]==='number'?Number(input.value):input.value;
  if(key==='voice')pause();
  if(['silenceThreshold','silenceDelay'].includes(key)&&cameraMode&&stream)audioMonitor.start(stream,{thresholdDb:settings.silenceThreshold,silenceMs:settings.silenceDelay});
  normaliseSettings();save();applySettings();setProgress(oldFraction);stats();
  if(key==='keepAwake'){if(settings.keepAwake)await keepAwake();else releaseAwake();}
  if(cameraMode&&['facing','quality','frameRate'].includes(key)&&(!recorder||recorder.state==='inactive'))await startCamera();
};
$('#reader-settings').onclick=()=>{pause();applySettings();$('#settings-dialog').showModal();};
function setSpeed(wpm){settings.wpm=Math.min(300,Math.max(40,wpm));save();applySettings();stats();}
$('#quick-speed').oninput=e=>setSpeed(Number(e.target.value));$('#slower').onclick=()=>setSpeed(settings.wpm-5);$('#faster').onclick=()=>setSpeed(settings.wpm+5);

function renderPrompt(){
  const container=$('#prompt-text');container.replaceChildren();let wordIndex=0;
  for(const paragraph of current.text.split(/\n\s*\n/u)){
    const p=document.createElement('p');
    const parts=paragraph.split(/(\*\*[^*]+\*\*|==[^=]+==)/g);
    for(const part of parts){let node=p,text=part;if(part.startsWith('**')&&part.endsWith('**')){node=document.createElement('strong');text=part.slice(2,-2);p.append(node);}else if(part.startsWith('==')&&part.endsWith('==')){node=document.createElement('mark');text=part.slice(2,-2);p.append(node);}
      for(const token of text.split(/(\s+)/u)){if(!token)continue;if(/^\s+$/u.test(token)){node.append(document.createTextNode(token));continue;}const word=document.createElement('span');word.textContent=token;word.dataset.word=wordIndex++;node.append(word);}
    }container.append(p);
  }
}
function maxScroll(){return Math.max(0,$('#prompt-scroll').scrollHeight-$('#prompt-scroll').clientHeight);}
function progress(){return maxScroll()?$('#prompt-scroll').scrollTop/maxScroll():0;}
function setProgress(fraction){scrollPosition=Math.max(0,Math.min(1,fraction))*maxScroll();$('#prompt-scroll').scrollTop=scrollPosition;updatePosition();if(voiceFollower)voiceFollower.seek(Math.floor(fraction*wordCount(current.text)));}
function updatePosition(){const fraction=progress();$('#read-progress').value=fraction*100;$('#read-position').textContent=`${Math.round(fraction*100)}%`;}
$('#read-progress').oninput=e=>{pause();setProgress(Number(e.target.value)/100);};
$('#prompt-scroll').addEventListener('pointerdown',()=>pause());
$('#prompt-scroll').addEventListener('wheel',()=>pause(),{passive:true});
$('#prompt-scroll').addEventListener('scroll',()=>{if(!playing)scrollPosition=$('#prompt-scroll').scrollTop;updatePosition();},{passive:true});
$('#read-script').onclick=()=>openReader(false);$('#record-script').onclick=()=>openReader(true);
async function openReader(camera){
  save();cameraMode=camera;readerOpen=true;if(camera)audioMonitor.prepare();sessionElapsed=0;$('#workspace').hidden=true;$('#reader').hidden=false;$('#reader').classList.toggle('camera-mode',camera);document.body.classList.add('reading');$('#record-toggle').hidden=!camera;$('#finish-recording').hidden=true;$('#camera-message').hidden=true;$('#session-status').textContent=camera?'Opening camera…':'Ready';$('#elapsed').textContent='0:00';$('#record-toggle').disabled=camera;renderPrompt();applySettings();setProgress(0);updateButtons();
  if(camera)await startCamera();else if(settings.keepAwake)await keepAwake();
}
function stopCamera(keepMonitor=false){cameraRequest++;if(!keepMonitor){audioMonitor.stop();monitorReady=false;soundDetected=false;}if(stream){for(const track of stream.getTracks())track.stop();stream=null;}$('#camera-preview').srcObject=null;}
async function startCamera(){
  audioMonitor.prepare();stopCamera(true);const request=cameraRequest;$('#record-toggle').disabled=true;$('#camera-message').hidden=true;
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){$('#camera-message').textContent='This browser cannot record video. Open the app in Safari on an up-to-date iPhone or iPad. You can still practise reading.';$('#camera-message').hidden=false;$('#session-status').textContent='Camera unavailable';return;}
  try{
    const shortSide=Number(settings.quality),portrait=window.innerHeight>window.innerWidth;const newStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:settings.facing},width:{ideal:portrait?shortSide:Math.round(shortSide*16/9)},height:{ideal:portrait?Math.round(shortSide*16/9):shortSide},aspectRatio:{ideal:portrait?9/16:16/9},frameRate:{ideal:settings.frameRate}},audio:{echoCancellation:true,noiseSuppression:true}});
    if(!readerOpen||!cameraMode||request!==cameraRequest){newStream.getTracks().forEach(t=>t.stop());return;}
    stream=newStream;audioMonitor.start(stream,{thresholdDb:settings.silenceThreshold,silenceMs:settings.silenceDelay});$('#camera-preview').srcObject=stream;await $('#camera-preview').play();$('#record-toggle').disabled=false;const actual=stream.getVideoTracks()[0]?.getSettings();$('#session-status').textContent=`Camera ready${actual?.height?` · ${actual.width}×${actual.height}${actual.frameRate?` · ${Math.round(actual.frameRate)} fps`:''}`:''}`;
    for(const track of stream.getTracks())track.onended=()=>{if(recorder&&recorder.state!=='inactive')finishRecording('Camera interrupted');else{$('#record-toggle').disabled=true;$('#session-status').textContent='Camera stopped — close and reopen';}};
    renderDeviceCameraControls();applySettings();if(settings.keepAwake)await keepAwake();
  }catch(e){if(request!==cameraRequest)return;audioMonitor.stop();const denied=['NotAllowedError','PermissionDeniedError'].includes(e.name);$('#camera-message').textContent=denied?'Camera or microphone access was denied. Allow both in Safari’s website settings, then close and reopen the recording screen. Your script is safe.':'The camera could not start. Close other camera apps, check that a microphone is available, then try again.';$('#camera-message').hidden=false;$('#session-status').textContent=denied?'Permission needed':'Camera unavailable';}
}
function renderDeviceCameraControls(){
  const holder=$('#device-camera-controls');holder.replaceChildren();const track=stream?.getVideoTracks()[0];if(!track?.getCapabilities)return;
  const caps=track.getCapabilities(),values=track.getSettings();
  for(const [key,title]of [['zoom','Zoom'],['exposureCompensation','Exposure']]){const range=caps[key];if(!range||range.max<=range.min)continue;const label=document.createElement('label');label.textContent=title;const input=document.createElement('input');input.type='range';input.min=range.min;input.max=range.max;input.step=range.step||.1;input.value=values[key]??range.min;input.oninput=async()=>{try{await track.applyConstraints({advanced:[{[key]:Number(input.value)}]});}catch{toast(`${title} could not be changed on this camera.`);}};label.append(input);holder.append(label);}
  for(const [key,title]of [['focusMode','Focus'],['exposureMode','Exposure mode']]){const modes=caps[key];if(!Array.isArray(modes)||!modes.includes('continuous')||!modes.includes('manual'))continue;const label=document.createElement('label');label.textContent=title;const select=document.createElement('select');for(const [value,text]of [['continuous','Automatic'],['manual','Lock current setting']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}select.value=values[key]||'continuous';select.onchange=async()=>{try{await track.applyConstraints({advanced:[{[key]:select.value}]});}catch{toast(`${title} lock is unavailable on this camera.`);}};label.append(select);holder.append(label);}
}
function wordAtGuide(){const target=$('#prompt-scroll').scrollTop+$('#prompt-scroll').clientHeight*.24;const words=$$('#prompt-text [data-word]');let candidate=0;for(const word of words){if(word.offsetTop>target+2)break;candidate=Number(word.dataset.word);}const line=words[candidate]?.offsetTop;while(candidate>0&&words[candidate-1].offsetTop===line)candidate--;return candidate;}
function ensureMonitor(){if(!stream)return false;return audioMonitor.running?audioMonitor.resume():audioMonitor.start(stream,{thresholdDb:settings.silenceThreshold,silenceMs:settings.silenceDelay});}
function updateButtons(){const recording=recorder&&recorder.state!=='inactive';$('#play-reader').textContent=pendingStart?'Cancel countdown':(playing||finishAt)?'Ⅱ Pause':recording?'▶ Resume':cameraMode?'▶ Preview words':'▶ Read';$('#record-toggle').hidden=!cameraMode||!!recording;$('#finish-recording').hidden=!recording;$('#restart-reader').disabled=!!recording||recordingStarting;$('#record-toggle').disabled=recordingStarting||!stream;$('#play-reader').disabled=recordingStarting&&!pendingStart;}
function pause(){finishAt=0;countdownToken++;pendingStart=false;$('#countdown-overlay').hidden=true;playing=false;lastFrame=0;voiceFollower?.stop();voiceFollower=null;if(recorder?.state==='recording'){accumulateRecording();recorder.pause();$('#session-status').textContent='Take paused';}else if(readerOpen&&(!recorder||recorder.state==='inactive'))$('#session-status').textContent='Paused';updateButtons();}
async function countIn(){const token=++countdownToken;pendingStart=true;updateButtons();for(let n=settings.countdown;n>0;n--){$('#countdown-overlay').textContent=n;$('#countdown-overlay').hidden=false;await wait(1000);if(token!==countdownToken||!readerOpen)return false;}$('#countdown-overlay').hidden=true;pendingStart=false;updateButtons();return token===countdownToken&&readerOpen;}
async function play(){
  if(finishAt||pendingStart||playing){pause();return;}
  if(cameraMode&&!ensureMonitor()&&settings.pauseOnSilence){message('Sound assistance unavailable','Turn off Pause words during silence in Reading settings to continue with fixed-speed scrolling. Your recording can still be saved.');return;}
  if(progress()>=.999)setProgress(0);
  if(settings.voice&&!cameraMode){try{voiceFollower=new VoiceFollower({text:plainText(current.text),language:settings.language,onPosition:index=>{const word=$(`[data-word="${index}"]`);if(word){scrollPosition=Math.max(0,word.offsetTop-$('#prompt-scroll').clientHeight*.24);$('#prompt-scroll').scrollTop=scrollPosition;updatePosition();}},onStatus:status=>{$('#session-status').textContent=status;if(status==='End of script.'||status==='No script remains to read.'){playing=false;lastFrame=0;updateButtons();}},onError:error=>{pause();message('Voice following stopped',`${error.message||error}\nYou can turn off voice following in settings and use fixed-speed reading.`);}});if(!voiceFollower.start(wordAtGuide())){playing=false;voiceFollower=null;updateButtons();return;}}catch(e){message('Voice following unavailable',e.message);return;}}
  else if(!recorder||recorder.state==='inactive'){if(!(await countIn()))return;}
  if(recorder?.state==='paused'){recorder.resume();recordStarted=performance.now();recordSegmentActive=true;}
  playing=true;lastFrame=0;scrollPosition=$('#prompt-scroll').scrollTop;$('#session-status').textContent=recorder?.state==='recording'?'● Recording':settings.voice&&!cameraMode?'Listening…':'Reading';updateButtons();await keepAwake();
}
$('#play-reader').onclick=play;
$('#restart-reader').onclick=()=>{pause();setProgress(0);sessionElapsed=0;$('#elapsed').textContent='0:00';$('#session-status').textContent='Ready';};
function tick(now){
  if(readerOpen){const delta=lastFrame?Math.min((now-lastFrame)/1000,.1):0;lastFrame=now;
    if(playing){sessionElapsed+=delta;if(!voiceFollower&&!(cameraMode&&settings.pauseOnSilence&&!soundDetected)){const seconds=wordCount(current.text)/settings.wpm*60;scrollPosition+=maxScroll()/Math.max(seconds,1)*delta;$('#prompt-scroll').scrollTop=scrollPosition;updatePosition();if(scrollPosition>=maxScroll()){if(settings.loop&&!cameraMode)setProgress(0);else{playing=false;if(recorder?.state==='recording'&&settings.finishDelay>0)finishAt=now+settings.finishDelay*1000;$('#session-status').textContent=recorder?.state==='recording'?'Script finished · tap Finish':'Finished';updateButtons();}}}}
    if(finishAt&&recorder?.state==='recording'){const left=Math.ceil((finishAt-now)/1000);if(left<=0){finishAt=0;finishRecording();}else $('#session-status').textContent=`Finishing in ${left}s · Pause to cancel`;}
    const elapsed=recorder&&recorder.state!=='inactive'?recordAccum+(recorder.state==='recording'?(now-recordStarted)/1000:0):sessionElapsed;$('#elapsed').textContent=clock(elapsed);
  }requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
async function keepAwake(){if(!settings.keepAwake||!readerOpen||document.hidden)return;if(!navigator.wakeLock){$('#awake-state').textContent='Auto-lock may apply';return;}try{if(!wakeLock||wakeLock.released){wakeLock=await navigator.wakeLock.request('screen');wakeLock.addEventListener('release',()=>{$('#awake-state').textContent='Screen may lock';});}$('#awake-state').textContent='Screen awake';}catch{$('#awake-state').textContent='Screen may lock';}}
function releaseAwake(){wakeLock?.release().catch(()=>{});wakeLock=null;$('#awake-state').textContent='';}
function bestMime(){for(const type of ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'])if(MediaRecorder.isTypeSupported(type))return type;return '';}
$('#record-toggle').onclick=async()=>{
  if(recordingStarting||pendingStart||stopPromise||recorder&&recorder.state!=='inactive')return;
  if(!stream){message('Camera unavailable','Close the reading screen and open Record video again.');return;}
  if(!ensureMonitor()&&settings.pauseOnSilence){message('Sound assistance unavailable','Turn off Pause words during silence in Reading settings to record with fixed-speed scrolling.');return;}recordingStarting=true;pause();updateButtons();
  let preparedTake;
  try{
    if(!(await countIn()))return;
    const capturedStream=stream,token=countdownToken,request=cameraRequest;
    const mime=bestMime();const activeRecorder=new MediaRecorder(capturedStream,mime?{mimeType:mime}:undefined);
    recordChunks=[];recordStorageError=null;chunkIndex=0;chunkQueue=Promise.resolve();recordAccum=0;
    const videoSettings=capturedStream.getVideoTracks()[0].getSettings();
    const take={id:uid(),title:current.title||'Untitled script',created:Date.now(),mimeType:activeRecorder.mimeType||mime,duration:0,bytes:0,width:videoSettings.width,height:videoSettings.height,frameRate:videoSettings.frameRate,status:'recording',script:plainText(current.text)};
    preparedTake=take;
    try{await saveTake(take);}catch(e){recordStorageError=e;}
    if(!readerOpen||!cameraMode||stream!==capturedStream||cameraRequest!==request||countdownToken!==token){await deleteTake(take.id).catch(()=>{});return;}
    recordInfo=take;recorder=activeRecorder;
    activeRecorder.ondataavailable=e=>{if(!e.data.size)return;recordChunks.push(e.data);take.bytes+=e.data.size;const index=chunkIndex++;chunkQueue=chunkQueue.then(()=>saveChunk(take.id,index,e.data)).catch(error=>{recordStorageError=error;});};
    activeRecorder.onerror=()=>finishRecording('Recording interrupted');
    activeRecorder.onstop=async()=>{
      accumulateRecording();playing=false;voiceFollower?.stop();await chunkQueue;take.status='saved';take.duration=recordAccum;take.mimeType=activeRecorder.mimeType||take.mimeType;
      try{await saveTake(take);}catch(e){recordStorageError=e;}
      const blob=new Blob(recordChunks,{type:take.mimeType});const finished={...take,volatile:!!recordStorageError};if(recordStorageError)finished.warning='Device storage could not keep this take. Save or share it now, before closing.';
      recorder=null;recordChunks=[];stopCamera();updateButtons();await closeReader(false);
      if(blob.size)await openTake(finished,blob);else message('No video was captured','Try a short recording again. Check camera and microphone permissions.');
      resolveStop?.();resolveStop=null;stopPromise=null;
    };
    activeRecorder.start(1000);recordStarted=performance.now();recordSegmentActive=true;playing=true;lastFrame=0;scrollPosition=$('#prompt-scroll').scrollTop;$('#session-status').textContent='● Recording';updateButtons();await keepAwake();
  }catch(e){recorder=null;if(preparedTake)await deleteTake(preparedTake.id).catch(()=>{});message('Could not record',`${e.message}\nTry a lower video quality in Reading settings.`);}
  finally{recordingStarting=false;updateButtons();}
};
async function finishRecording(reason='Saving take…'){
  finishAt=0;
  if(stopPromise)return stopPromise;if(!recorder||recorder.state==='inactive')return;
  countdownToken++;pendingStart=false;$('#countdown-overlay').hidden=true;playing=false;$('#session-status').textContent=reason;$('#finish-recording').disabled=true;
  stopPromise=new Promise(resolve=>resolveStop=resolve);accumulateRecording();recorder.stop();await stopPromise;$('#finish-recording').disabled=false;
}
$('#finish-recording').onclick=()=>finishRecording();
async function closeReader(check=true){if(check&&stopPromise){await stopPromise;return;}if(check&&recorder&&recorder.state!=='inactive'){await finishRecording();return;}pause();readerOpen=false;stopCamera();releaseAwake();$('#reader').hidden=true;$('#workspace').hidden=false;document.body.classList.remove('reading');if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});}
$('#exit-reader').onclick=()=>closeReader();
$('#fullscreen-reader').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if($('#reader').requestFullscreen)await $('#reader').requestFullscreen();else toast('Install to the Home Screen for a full-screen view.');}catch{toast('Full screen is unavailable here. Use the Home Screen app.');}};
document.addEventListener('keydown',e=>{if(!readerOpen||$('dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if([' ','ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','Escape'].includes(e.key))e.preventDefault();if(e.key===' ')play();if(e.key==='ArrowDown'){pause();$('#prompt-scroll').scrollTop+=settings.fontSize*settings.lineHeight;}if(e.key==='ArrowUp'){pause();$('#prompt-scroll').scrollTop-=settings.fontSize*settings.lineHeight;}if(e.key==='ArrowLeft')setSpeed(settings.wpm-5);if(e.key==='ArrowRight')setSpeed(settings.wpm+5);if(e.key==='Home'&&(!recorder||recorder.state==='inactive')){$('#restart-reader').click();}if(e.key==='Escape')closeReader();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(recorder&&recorder.state!=='inactive')finishRecording('Interrupted · saving take…');else pause();releaseAwake();}else if(readerOpen)keepAwake();});
window.addEventListener('resize',()=>{if(readerOpen){const p=progress();applySettings();setProgress(p);}});
window.addEventListener('beforeunload',e=>{if(recorder&&recorder.state!=='inactive'){e.preventDefault();e.returnValue='';}});

async function renderTakes(){
  const container=$('#takes-list');container.replaceChildren();
  try{const takes=await listTakes();if(!takes.length){const p=document.createElement('p');p.className='empty-state';p.textContent='Your recordings will appear here. Open a script and choose Record video.';container.append(p);return;}
    for(const take of takes){const card=document.createElement('article');card.className='take-card';const h=document.createElement('h2');h.textContent=take.title;const p=document.createElement('p');p.textContent=`${new Date(take.created).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})} · ${take.status==='recording'?'Interrupted take':clock(take.duration)}`;const b=document.createElement('button');b.className='outline';b.textContent='Review take';b.onclick=()=>openTake(take);const remove=document.createElement('button');remove.className='text-button danger';remove.textContent='Delete';remove.onclick=async()=>{if(confirm('Delete this take?')){await deleteTake(take.id);renderTakes();}};const row=document.createElement('div');row.className='button-row';row.append(b,remove);card.append(h,p,row);container.append(card);}
  }catch{const p=document.createElement('p');p.className='notice';p.textContent='Recordings storage is unavailable. Check available device storage and use normal browsing, rather than private browsing.';container.append(p);}
}
async function openTake(take,blob){
  try{selectedTake=take;selectedBlob=blob||await takeBlob(take);if(takeURL)URL.revokeObjectURL(takeURL);takeURL=URL.createObjectURL(selectedBlob);$('#take-player').src=takeURL;$('#take-title').textContent=take.title;$('#take-meta').textContent=take.warning||`${clock(take.duration)} · ${(selectedBlob.size/1024/1024).toFixed(1)} MB · ${take.width||'?'}×${take.height||'?'} · ${selectedBlob.type.includes('mp4')?'MP4':'WebM'}${take.status==='recording'?' · Interrupted recording; playback may be incomplete':''}`;$('#trim-start').value=0;trimEndEdited=false;$('#trim-end').value=(take.duration||0).toFixed(1);$('#caption-text').value=take.captions?toSrt(take.captions):'';captionDirty=false;$('#caption-save-state').textContent=take.captions?.length?'Captions saved with this take.':'Caption edits can be kept with this take.';$('#burn-captions').checked=false;$('#video-aspect').value='original';$('#video-logo').value='';$('#video-music').value='';resetEffects();restoreCaptionStyle(take.captionStyle);$('#edit-take').open=false;$('#export-progress').hidden=true;previewTrimEnd=null;$('#take-dialog').showModal();automaticCaptions.refresh();}
  catch(e){message('Could not open take',`${e.message}\nAn interrupted recording may not have saved enough data. You can remove empty takes from the list.`);}
}
function canLeaveTake(){if(automaticCaptions.isBusy()){toast('Use Cancel captions before closing.');return false;}return !captionDirty||confirm('Leave without keeping your caption edits? Use Keep captions with this take to save them.');}
$('#take-dialog .dialog-heading').addEventListener('submit',e=>{if(!canLeaveTake())e.preventDefault();});
$('#take-dialog').addEventListener('cancel',e=>{if(exportController){e.preventDefault();toast('Use Cancel processing before closing.');}else if(!canLeaveTake())e.preventDefault();});
$('#take-dialog').addEventListener('close',()=>{automaticCaptions.dispose();exportController?.abort();$('#take-player').pause();$('#take-player').removeAttribute('src');$('#take-player').load();if(takeURL){URL.revokeObjectURL(takeURL);takeURL=null;}selectedBlob=null;selectedTake=null;if(activeView==='takes')renderTakes();});
$('#share-take').onclick=async()=>{if(!selectedBlob)return;try{const shared=await shareFile(selectedBlob,`${fileName(selectedTake.title)}.${selectedBlob.type.includes('mp4')?'mp4':'webm'}`,selectedTake.title);if(!shared)toast('Video download started');}catch(e){if(e.name!=='AbortError')message('Could not share video',`${e.message}\nTry the Download button instead.`);}};
$('#download-take').onclick=()=>{if(selectedBlob)download(selectedBlob,`${fileName(selectedTake.title)}.${selectedBlob.type.includes('mp4')?'mp4':'webm'}`);};
$('#delete-take').onclick=async()=>{if(!selectedTake||!confirm('Delete this take from this device? Saved copies in Photos or Files will remain.'))return;try{await deleteTake(selectedTake.id);$('#take-dialog').close();toast('Take deleted');}catch(e){message('Could not delete',e.message);}};

$('#take-player').addEventListener('loadedmetadata',()=>{const duration=$('#take-player').duration;if(Number.isFinite(duration)&&duration>0){if(!trimEndEdited)$('#trim-end').value=duration.toFixed(2);$('#trim-start').max=duration;$('#trim-end').max=duration;}});
$('#take-player').addEventListener('timeupdate',()=>{if(previewTrimEnd!==null&&$('#take-player').currentTime>=previewTrimEnd){$('#take-player').pause();previewTrimEnd=null;}});
$('#set-trim-start').onclick=()=>$('#trim-start').value=$('#take-player').currentTime.toFixed(2);
for(const event of ['input','change'])$('#trim-end').addEventListener(event,()=>{trimEndEdited=true;});
$('#set-trim-end').onclick=()=>{trimEndEdited=true;$('#trim-end').value=$('#take-player').currentTime.toFixed(2);};
function trimRange(){const start=Number($('#trim-start').value),end=Number($('#trim-end').value);if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)throw new Error('End time must be later than the start time.');const duration=$('#take-player').duration;if(Number.isFinite(duration)&&(start>=duration||end>duration+.05))throw new Error('Choose start and end times within this take.');return {start,end:Math.min(end,Number.isFinite(duration)?duration:end)};}
$('#preview-trim').onclick=async()=>{try{const {start,end}=trimRange();$('#take-player').currentTime=start;previewTrimEnd=end;await $('#take-player').play();}catch(e){message('Check the selection',e.message);}};
$('#draft-captions').onclick=()=>{if(!selectedTake?.script){message('No script for this take','Import an SRT file or enter captions and timings below.');return;}if($('#caption-text').value&&!confirm('Replace the current captions with a script draft?'))return;const words=selectedTake.script.split(/\s+/u).filter(Boolean),duration=selectedTake.duration||Number($('#trim-end').value);if(!(duration>0))return;const captions=[];for(let i=0;i<words.length;i+=8)captions.push({start:i/words.length*duration,end:Math.min(i+8,words.length)/words.length*duration,text:words.slice(i,i+8).join(' ')});$('#caption-text').value=toSrt(captions);captionChanged();toast('Estimated captions added. Check every word and timing.');};
$('#import-captions').onclick=()=>$('#captions-file').click();
$('#captions-file').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>2*1024*1024)throw new Error('Choose an SRT file under 2 MB.');const text=await file.text();const captions=parseSrt(text);$('#caption-text').value=toSrt(captions);captionChanged();toast(`${captions.length} captions imported`);}catch(e){message('Could not import captions',e.message);}};
function captionChanged(){captionDirty=true;$('#effects-preview').hidden=true;$('#caption-save-state').textContent='Caption changes not yet saved.';}
$('#caption-text').addEventListener('input',captionChanged);
$('#save-captions').onclick=async()=>{
  if(!selectedTake)return;const id=selectedTake.id,text=$('#caption-text').value,captionStyle=effectsOptions().captionStyle,button=$('#save-captions');button.disabled=true;
  try{const captions=parseSrt(text),updated=await updateTakeMetadata(id,{captions,captionStyle});if(selectedTake?.id===id){selectedTake=updated;captionDirty=$('#caption-text').value!==text||JSON.stringify(effectsOptions().captionStyle)!==JSON.stringify(captionStyle);$('#caption-save-state').textContent=captionDirty?'New caption changes not yet saved.':'Captions saved with this take.';}}
  catch(e){message('Could not save captions',e.message);}
  finally{button.disabled=false;}
};
$('#export-captions').onclick=()=>{try{const captions=parseSrt($('#caption-text').value);if(!captions.length)throw new Error('Add captions first.');download(new Blob([toSrt(captions,trimRange())],{type:'text/plain;charset=utf-8'}),`${fileName(selectedTake.title)}.srt`);}catch(e){message('Check the captions',e.message);}};
$('#export-audio').onclick=async()=>{if(!selectedBlob||exportController||automaticCaptions.isBusy()||audioExportBusy)return;const take={...selectedTake},blob=selectedBlob;const button=$('#export-audio');button.disabled=true;audioExportBusy=true;automaticCaptions.refresh();try{const range=trimRange();toast('Preparing audio…');const audio=await exportAudio(blob,range);download(audio,`${fileName(take.title)}.wav`);toast('Audio download ready');}catch(e){message('Could not export audio',e.message);}finally{button.disabled=false;audioExportBusy=false;automaticCaptions.refresh();}};
function resetEffects(){
  for(const [id,value]of Object.entries({'overlay-title':'','title-position':'top','title-size':'medium','title-color':'#ffffff','chroma-key':'off','chroma-threshold':'0.20','chroma-color':'#163b83','chroma-image':'','caption-size':'medium','caption-color':'#ffffff','caption-position':'bottom','edit-size':'1920'}))$('#'+id).value=value;
  $('#caption-background').checked=true;$('#effects-preview').hidden=true;
}
function restoreCaptionStyle(style={}){
  for(const [id,key,allowed]of [['caption-size','size',['small','medium','large']],['caption-color','color',['#ffffff','#ffe66e']],['caption-position','position',['top','center','bottom']]])if(allowed.includes(style?.[key]))$('#'+id).value=style[key];
  if(typeof style?.background==='boolean')$('#caption-background').checked=style.background;
}
for(const id of ['caption-size','caption-color','caption-position','caption-background'])$('#'+id).addEventListener('input',captionChanged);
function effectsOptions(){return {maxEdge:Number($('#edit-size').value),title:{text:$('#overlay-title').value,position:$('#title-position').value,size:$('#title-size').value,color:$('#title-color').value},captionStyle:{size:$('#caption-size').value,color:$('#caption-color').value,position:$('#caption-position').value,background:$('#caption-background').checked},chroma:{enabled:$('#chroma-key').value!=='off',key:$('#chroma-key').value==='blue'?'blue':'green',threshold:Number($('#chroma-threshold').value),backgroundColor:$('#chroma-color').value},background:$('#chroma-image').files[0]};}
async function imageForPreview(blob){if(!blob)return null;if(blob.size>10*1024*1024)throw new Error('Choose a picture under 10 MB.');const image=new Image(),url=URL.createObjectURL(blob);try{image.src=url;await image.decode();return image;}catch{throw new Error('Could not read that image. Try a PNG or JPEG.');}finally{URL.revokeObjectURL(url);}}
$('#preview-effects').onclick=async()=>{
  const button=$('#preview-effects');button.disabled=true;let effects;
  try{
    const video=$('#take-player');video.pause();previewTrimEnd=null;if(video.readyState<2)throw new Error('Play or move through the video first so a frame is ready.');
    const options=effectsOptions(),captions=$('#burn-captions').checked?parseSrt($('#caption-text').value):[];
    const [backgroundImage,logoImage]=await Promise.all([imageForPreview(options.chroma.enabled?options.background:undefined),imageForPreview($('#video-logo').files[0])]);
    const {createCompositor}=await import('./visual-effects.js');
    let w=video.videoWidth,h=video.videoHeight,x=0,y=0;const aspect=$('#video-aspect').value;
    if(aspect!=='original'){const [a,b]=aspect.split(':').map(Number),ratio=a/b;if(w/h>ratio){const next=h*ratio;x=(w-next)/2;w=next;}else{const next=w/ratio;y=(h-next)/2;h=next;}}
    const canvas=$('#effects-preview canvas'),scale=Math.min(1,960/w);canvas.width=Math.round(w*scale);canvas.height=Math.round(h*scale);const ctx=canvas.getContext('2d',{willReadFrequently:options.chroma.enabled});ctx.drawImage(video,x,y,w,h,0,0,canvas.width,canvas.height);
    effects=createCompositor({width:canvas.width,height:canvas.height,...options,backgroundImage});effects.draw(ctx,{time:video.currentTime,captions});
    if(logoImage){const size=Math.min(canvas.width*.22/logoImage.naturalWidth,canvas.height*.15/logoImage.naturalHeight),lw=logoImage.naturalWidth*size,lh=logoImage.naturalHeight*size,gap=Math.min(canvas.width,canvas.height)*.035;ctx.drawImage(logoImage,canvas.width-lw-gap,gap,lw,lh);}
    $('#effects-preview').hidden=false;
  }catch(e){message('Could not preview appearance',e.message);}finally{effects?.dispose();button.disabled=false;}
};
$('#edit-take').addEventListener('input',()=>{$('#effects-preview').hidden=true;});
let exportDisabledStates=new Map();
function setExportBusy(busy,cancelId='cancel-export'){
  if(busy){for(const element of $$('#take-dialog button, #take-dialog input, #take-dialog select, #take-dialog textarea'))if(element.id!==cancelId){exportDisabledStates.set(element,element.disabled);element.disabled=true;}$('#take-player').controls=false;}
  else{for(const [element,disabled]of exportDisabledStates)element.disabled=disabled;exportDisabledStates.clear();$('#take-player').controls=true;}
}
$('#cancel-export').onclick=()=>exportController?.abort();
$('#export-edit').onclick=async()=>{
  if(!selectedBlob||exportController||audioExportBusy||automaticCaptions.isBusy())return;const take={...selectedTake};
  try{
    const range=trimRange();const captions=$('#burn-captions').checked?parseSrt($('#caption-text').value):[];if($('#burn-captions').checked&&!captions.length)throw new Error('Add captions or turn off “Add these captions to the video”.');
    if(!getVideoProcessingSupport().supported)throw new Error('This browser cannot create edited videos. You can still download the original and save SRT captions. Try an up-to-date Safari.');
    const logo=$('#video-logo').files[0],music=$('#video-music').files[0],effects=effectsOptions();if(logo?.size>10*1024*1024||effects.background?.size>10*1024*1024||music?.size>50*1024*1024)throw new Error('Choose a picture under 10 MB and music under 50 MB.');
    $('#take-player').pause();previewTrimEnd=null;exportController=new AbortController();$('#export-progress').hidden=false;setExportBusy(true);
    const result=await processVideo({blob:selectedBlob,...range,...effects,captions,aspect:$('#video-aspect').value,logo,music,musicVolume:Number($('#music-volume').value)/100,signal:exportController.signal,onProgress:info=>{$('#export-progress progress').value=info.progress;$('#export-progress p').textContent=info.phase==='rendering'?`Creating your copy… ${Math.round(info.progress*100)}%`:'Preparing video…';}});
    const edited={...take,id:uid(),title:`${take.title} (edited)`,created:Date.now(),duration:result.duration,mimeType:result.mimeType,width:result.width,height:result.height,bytes:result.blob.size,status:'saved',frameRate:undefined,captions:trimCaptions(captions,range.start,range.end),captionStyle:effects.captionStyle,script:undefined};
    try{await saveChunk(edited.id,0,result.blob);await saveTake(edited);}catch{edited.warning='Device storage could not keep this edited take. Save or share it now.';}
    exportController=null;await openTake(edited,result.blob);toast('Edited copy ready. Original kept.');
  }catch(e){if(e.code!=='ABORTED'&&e.name!=='AbortError')message('Could not create edited copy',e.message);else toast('Processing cancelled. Original kept.');}
  finally{exportController=null;setExportBusy(false);$('#export-progress').hidden=true;automaticCaptions.refresh();}
};

const automaticCaptions=setupAutomaticCaptions({
  getTake:()=>selectedTake&&{id:selectedTake.id,blob:selectedBlob,duration:Number.isFinite($('#take-player').duration)&&$('#take-player').duration>0?$('#take-player').duration:selectedTake.duration},
  getRange:trimRange,onCaptions:captionChanged,setBusy:setExportBusy,onError:message,canStart:()=>!exportController&&!audioExportBusy
});

async function setupOffline(){
  if(!('serviceWorker'in navigator)){$('#offline-state').textContent='Offline installation is unavailable in this browser.';return;}
  try{const registration=await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;$('#offline-state').textContent='Ready for offline use. Open the Home Screen app once while online too.';registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)toast('An update is ready. Close all app windows, then reopen.');});});}
  catch{$('#offline-state').textContent='Offline download did not finish. Reopen while online to try again.';}
}
selectScript(current.id);setupOffline();
if(storageError)message('Saved scripts need attention','The stored script library could not be read. Existing storage has not been overwritten. Back up any recovered text before clearing website data.');
