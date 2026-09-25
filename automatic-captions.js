import {prepareTranscriptionAudio} from './transcription-audio.js';
import {parseSrt,toSrt} from './video-processing.js';

/** Optional local speech tools, kept separate from recording and playback. */
export function setupAutomaticCaptions({getTake,getRange,onCaptions,setBusy,onError,canStart}) {
  const $=id=>document.getElementById(id);
  let transcriber,controller,loading;
  const status=$('asr-status'),progress=$('asr-progress'),meter=progress.querySelector('progress');
  const getEngine=()=>loading||(loading=import('./asr/local-asr.js').then(({createLocalTranscriber})=>transcriber=createLocalTranscriber()).catch(error=>{loading=null;throw error;}));
  async function refresh(force=false){
    if(controller&&!force)return;
    if(!canStart()){ $('asr-transcribe').disabled=true;return;}
    try{
      const state=await(await getEngine()).getStatus();
      if((controller&&!force)||!canStart())return;
      $('asr-prepare').hidden=state.prepared;
      $('asr-transcribe').disabled=!state.prepared;
      $('asr-remove').hidden=state.downloadedBytes===0;
      status.textContent=state.prepared?'Caption tools saved on this device. Ready to work offline.':state.downloadedBytes?'The download is incomplete. Tap Download caption tools to finish.':'Download the optional caption tools once, then use them offline.';
    }catch(error){status.textContent=error.message||'Caption tools are unavailable in this browser.';$('asr-transcribe').disabled=true;}
  }
  function update(info){
    if(!controller)return;
    meter.value=Math.max(0,Math.min(1,info.progress||0));
    const percent=Math.round(meter.value*100);
    progress.querySelector('p').textContent=info.phase==='downloading'?`Downloading caption tools… ${percent}%`:info.phase==='transcribing'?`Listening to your recording… ${percent}%`:'Preparing the speech model…';
  }
  async function run(action){
    if(controller)return;
    if(!canStart()){onError('Finish the current export','Wait for the video or audio export to finish before starting captions.');return;}
    controller=new AbortController();const signal=controller.signal;
    progress.hidden=false;meter.value=0;progress.querySelector('p').textContent='Preparing…';setBusy(true,'asr-cancel');
    let feedback;
    try{feedback=await action(signal);}catch(error){if(error.name==='AbortError'||signal.aborted)feedback='Cancelled. Your previous captions are unchanged.';else onError('Could not create automatic captions',error.message||'Try a shorter selection or import an SRT file.');}
    finally{setBusy(false);await refresh(true);controller=null;progress.hidden=true;if(feedback)status.textContent=feedback;}
  }
  $('asr-prepare').onclick=()=>run(async signal=>{await(await getEngine()).prepare({signal,onProgress:update});});
  $('asr-transcribe').onclick=async()=>{
    let take,range,previous;
    try{
      take=getTake();if(!take?.blob)return;
      range=getRange();previous=parseSrt($('caption-text').value);
      if(previous.some(c=>c.end>range.start&&c.start<range.end)&&!confirm('Replace captions inside the selected start and end times? Captions outside that interval will be kept.'))return;
    }catch(error){onError('Check the caption selection',error.message);return;}
    await run(async signal=>{
      const engine=await getEngine();
      progress.querySelector('p').textContent='Reading the recording’s audio…';
      const input=await prepareTranscriptionAudio(take.blob,{...range,duration:take.duration,signal});
      const result=await engine.transcribe({audio:input.audio,sampleRate:input.sampleRate,signal,onProgress:update});
      if(signal.aborted)throw new DOMException('Cancelled','AbortError');
      const captions=result.captions.filter(c=>typeof c.text==='string'&&c.text.trim()&&Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>c.start).map(c=>({start:Math.max(range.start,c.start+input.offset),end:Math.min(range.end,c.end+input.offset),text:c.text.trim()})).filter(c=>c.end>c.start);
      if(!captions.length)throw new Error('No clear speech was recognised. Your existing captions were kept. Check that the selected interval contains English speech.');
      const preserved=previous.flatMap(c=>{
        if(c.end<=range.start||c.start>=range.end)return [c];
        const pieces=[];if(c.start<range.start)pieces.push({...c,end:range.start});if(c.end>range.end)pieces.push({...c,start:range.end});return pieces;
      });
      if(getTake()?.id!==take.id)return;
      $('caption-text').value=toSrt([...preserved,...captions].sort((a,b)=>a.start-b.start));
      onCaptions();
      return 'Speech captions added. Check every word and time, then keep them with this take.';
    });
  };
  $('asr-cancel').onclick=()=>controller?.abort();
  $('asr-remove').onclick=()=>run(async()=>{await(await getEngine()).clearCache();});
  return {refresh,isBusy:()=>!!controller,cancel:()=>controller?.abort(),dispose:()=>{controller?.abort();transcriber?.dispose();}};
}
