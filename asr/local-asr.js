import {ASSETS,CACHE_NAME,TOTAL_BYTES} from './asset-manifest.js';
const base=new URL('./',import.meta.url);
const fail=(code,message)=>Object.assign(new Error(message),{code});
let retired=Promise.resolve();
class SafeRuntime {
 constructor(){this.controller=new AbortController();this.closed=false;this.engine=null;}
 postMessage(message){
  this.pending=(async()=>{await retired;const {createEngine}=await import('./asr-engine.js');this.engine??=createEngine(this.controller.signal);return this.engine.run(message,p=>{if(!this.closed)this.onmessage?.({data:{id:message.id,progress:p}})});})();
  this.pending.then(result=>{if(!this.closed)this.onmessage?.({data:{id:message.id,result}})},error=>{if(!this.closed)this.onmessage?.({data:{id:message.id,error:{code:error.code||'TRANSCRIPTION_FAILED',message:error.message}}})});
 }
 terminate(){this.closed=true;this.controller.abort();const pending=this.pending;retired=Promise.resolve(pending).catch(()=>{}).then(()=>this.engine?.dispose()).catch(()=>{});}
}
const aborted=()=>new DOMException('Caption processing cancelled.','AbortError');
function check(signal){if(signal?.aborted)throw aborted();}
export function createLocalTranscriber(){
 let worker=null,active=null,nextId=0;
 function stop(){worker?.terminate();worker=null;}
 function call(type,data={},signal,onProgress){
  check(signal);
  if(active)throw fail('BUSY','Caption tools are already busy.');
  if(!worker)worker=new SafeRuntime();
  const id=++nextId;
  return new Promise((resolve,reject)=>{
   const cleanup=()=>{signal?.removeEventListener('abort',abort);active=null;};
   const abort=()=>{stop();cleanup();reject(aborted());};
   active={reject,cleanup};signal?.addEventListener('abort',abort,{once:true});
   worker.onerror=e=>{stop();cleanup();reject(fail('RUNTIME_FAILED',e.message||'Caption tools could not start in this browser.'));};
   worker.onmessage=({data:m})=>{if(m.id!==id)return;if(m.progress){onProgress?.(m.progress);return;}cleanup();if(m.error){stop();reject(fail(m.error.code||'TRANSCRIPTION_FAILED',m.error.message));}else resolve(m.result);};
   worker.postMessage({id,type,...data});
  });
 }
 async function getStatus(){
  if(!globalThis.caches||!globalThis.WebAssembly)throw fail('UNSUPPORTED','This browser cannot run offline caption tools. Try an up-to-date Safari.');
  const cache=await caches.open(CACHE_NAME);let downloadedBytes=0;const missing=[];
  for(const asset of ASSETS){const response=await cache.match(new URL(asset.path,base).href);if(response&&Number(response.headers.get('x-asr-bytes'))===asset.bytes)downloadedBytes+=asset.bytes;else missing.push(asset.path);}
  return {prepared:!missing.length,downloadedBytes,totalBytes:TOTAL_BYTES,missing,cacheName:CACHE_NAME};
 }
 let downloading=false,downloadController=null;
 async function prepare({signal:externalSignal,onProgress}={}){
  if(active||downloading)throw fail('BUSY','Caption tools are already busy.');
  check(externalSignal);downloadController=new AbortController();const signal=downloadController.signal;
  const abortDownload=()=>downloadController?.abort();externalSignal?.addEventListener('abort',abortDownload,{once:true});downloading=true;
  try{
   const state=await getStatus(),cache=await caches.open(CACHE_NAME);let loaded=state.downloadedBytes;
   for(const asset of ASSETS){
    check(signal);if(!state.missing.includes(asset.path))continue;
    const url=new URL(asset.path,base).href,response=await fetch(url,{signal,cache:'no-store'});
    if(!response.ok)throw fail('DOWNLOAD_FAILED','Caption tools could not download. Check your connection and try again.');
    const reader=response.body?.getReader();let chunks=[],bytes=0;
    if(reader){while(true){check(signal);const part=await reader.read();if(part.done)break;chunks.push(part.value);bytes+=part.value.byteLength;onProgress?.({phase:'downloading',progress:(loaded+bytes)/TOTAL_BYTES,loaded:loaded+bytes,total:TOTAL_BYTES,file:asset.path});}}
    else{const value=new Uint8Array(await response.arrayBuffer());chunks=[value];bytes=value.length;}
    check(signal);if(bytes!==asset.bytes)throw fail('INCOMPLETE_DOWNLOAD','The caption-tools download was incomplete. Please try again.');
    const blob=new Blob(chunks,{type:response.headers.get('Content-Type')||'application/octet-stream'});chunks=[];
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
    if(hash!==asset.sha256)throw fail('INTEGRITY_FAILED','Caption tools did not match the verified download. Please try again.');
    check(signal);await cache.put(url,new Response(blob,{headers:{'Content-Type':response.headers.get('Content-Type')||'application/octet-stream','Content-Length':String(bytes),'x-asr-bytes':String(bytes)}}));loaded+=bytes;
   }
   check(signal);downloading=false;onProgress?.({phase:'loading',progress:0});
   await call('load',{},signal,onProgress);return await getStatus();
  }catch(error){
   check(signal);
   if(error.name==='QuotaExceededError')throw fail('STORAGE_FULL','There is not enough browser storage for the caption tools. Free some device space and try again.');
   if(error instanceof TypeError&&!error.code)throw fail('DOWNLOAD_FAILED','Caption tools could not download. Connect to the internet and try again. Already downloaded files are kept.');
   throw error;
  }finally{downloading=false;downloadController=null;externalSignal?.removeEventListener('abort',abortDownload);}
 }
 async function transcribe({audio,sampleRate=16000,signal,onProgress}={}){
  check(signal);if(downloading||active)throw fail('BUSY','Caption tools are already busy.');
  if(!(audio instanceof Float32Array)||sampleRate!==16000||!audio.length)throw fail('INVALID_AUDIO','Provide non-empty mono audio at 16,000 samples per second.');
  if(audio.length>16000*600)throw fail('AUDIO_TOO_LONG','Select at most 10 minutes for automatic captions.');
  let sum=0,peak=0;for(const sample of audio){if(!Number.isFinite(sample))throw fail('INVALID_AUDIO','The audio contains invalid samples.');sum+=sample*sample;peak=Math.max(peak,Math.abs(sample));}
  if(Math.sqrt(sum/audio.length)<0.0001&&peak<0.001)return {text:'',captions:[],language:'en',reason:'silence'};
  if(!(await getStatus()).prepared)throw fail('NOT_PREPARED','Download the optional caption tools first.');
  check(signal);return call('transcribe',{audio},signal,onProgress);
 }
 async function clearCache(){if(downloading)throw fail('BUSY','Cancel the download before removing caption tools.');dispose();await caches.delete(CACHE_NAME);}
 function dispose(){downloadController?.abort();stop();if(active){const pending=active;pending.cleanup();pending.reject(aborted());}}
 return {prepare,transcribe,getStatus,clearCache,dispose};
}
