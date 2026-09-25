import {CACHE_NAME} from './asset-manifest.js';
export function createEngine(signal){
let transcriber;
const check=()=>{if(signal.aborted)throw new DOMException('Caption processing cancelled.','AbortError');};
async function load(progress){
 check();if(transcriber)return;
 const {pipeline,env}=await import('./vendor/transformers.min.js');
 env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath=new URL('./models/',import.meta.url).href;
 env.useBrowserCache=false;env.useFSCache=false;env.useCustomCache=true;env.customCache=await caches.open(CACHE_NAME);
 env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;env.backends.onnx.wasm.wasmPaths=new URL('./vendor/',import.meta.url).href;
 transcriber=await pipeline('automatic-speech-recognition','whisper-tiny.en',{device:'wasm',dtype:'q8',local_files_only:true,progress_callback:e=>{if(e.status==='ready')progress({phase:'loading',progress:1});}});
 const forward=transcriber.model.forward.bind(transcriber.model);transcriber.model.forward=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,0));check();return forward(...args);};
}
function cuesFromWords(words,duration){
 const captions=[];let current=null;
 for(const word of words){const text=word.text.trim();if(!text)continue;const start=Math.max(0,Math.min(duration,word.timestamp[0]??0)),end=Math.max(start,Math.min(duration,word.timestamp[1]??duration));if(end<=start)continue;
  if(!current||current.words>=7||end-current.start>4||start-current.end>1){current={start,end,text,words:1};captions.push(current);}else{current.end=end;current.text+=' '+text;current.words++;}
 }
 return captions.map(({words,...cue})=>cue);
}
async function run({type,audio},progress){
 check();
  await load(progress);if(type==='load')return true;
  const duration=audio.length/16000,words=[];let finished=0;
  // 30-second windows with 5 seconds of context on either side. Keep word centres from each non-overlapping 20-second core.
  for(let core=0;core<duration;core+=20){check();
   const start=Math.max(0,core-5),end=Math.min(duration,core+25),segment=audio.subarray(Math.round(start*16000),Math.round(end*16000));
   let energy=0;for(const x of segment)energy+=x*x;
   if(Math.sqrt(energy/segment.length)>=0.0001){
    const output=await transcriber(segment,{return_timestamps:'word',chunk_length_s:0,force_full_sequences:false});
    for(const word of output.chunks||[]){const a=word.timestamp[0],b=word.timestamp[1];if(!Number.isFinite(a)||!Number.isFinite(b))continue;const middle=start+(a+b)/2;if(middle>=core&&middle<Math.min(duration,core+20))words.push({text:word.text,timestamp:[a+start,b+start]});}
   }
   finished=Math.min(duration,core+20);progress({phase:'transcribing',progress:finished/duration,completedSeconds:finished,totalSeconds:duration});
  }
  check();const captions=cuesFromWords(words,duration);return {text:words.map(w=>w.text.trim()).join(' '),captions,language:'en',...(captions.length?{}:{reason:'nothing-recognized'})};
}
return {run,async dispose(){if(transcriber){const p=transcriber;transcriber=null;await p.dispose();}}};
}
