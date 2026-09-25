import {decodeSoundtrack} from './video-processing.js';

const RATE = 16000;
export const MAX_TRANSCRIPTION_SECONDS = 600;

/** Crop/downmix audio already resampled by Web Audio; preserve the video clock. */
export function selectMonoAudio(buffer, {start=0,end=buffer.duration,leadIn=0}={}) {
  if(buffer.sampleRate!==RATE)throw new Error('Speech audio must be decoded at 16 kHz.');
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||!Number.isFinite(leadIn)||leadIn<0)throw new Error('Choose a valid start and end time for captions.');
  if(end-start>MAX_TRANSCRIPTION_SECONDS)throw new Error('Choose up to 10 minutes at a time for automatic captions. Your full recording stays available.');
  if(!buffer.numberOfChannels)throw new Error('This recording has no audio track.');
  const first=Math.round(start*RATE),frames=Math.round(end*RATE)-first,offset=Math.round(leadIn*RATE);
  const samples=new Float32Array(frames);
  for(let channel=0;channel<buffer.numberOfChannels;channel++){
    const source=buffer.getChannelData(channel);
    const from=Math.max(0,offset-first),to=Math.min(frames,offset+source.length-first);
    for(let i=from;i<to;i++){
      const value=source[first+i-offset];
      samples[i]+=(Number.isFinite(value)?Math.max(-1,Math.min(1,value)):0)/buffer.numberOfChannels;
    }
  }
  return {audio:samples,sampleRate:RATE,offset:start,duration:frames/RATE};
}

export async function prepareTranscriptionAudio(blob, {start,end,duration,signal}={}) {
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const Offline=globalThis.OfflineAudioContext||globalThis.webkitOfflineAudioContext;
  if(!Offline)throw new Error('This browser cannot prepare audio for captions. You can still import or edit an SRT file.');
  if(!(blob instanceof Blob)||!blob.size)throw new Error('There is no recording to caption.');
  if(blob.size>100*1024*1024||!Number.isFinite(duration)||duration>900)throw new Error('To limit memory use, automatic captions currently accept source videos under 100 MB and 15 minutes. Create a shorter or smaller edited copy first, or import SRT captions. Your original recording is kept.');
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)throw new Error('Choose a valid start and end time for captions.');
  if(duration<=0||start>=duration||end>duration+.05)throw new Error('Choose start and end times inside this recording.');
  if(end-start>MAX_TRANSCRIPTION_SECONDS)throw new Error('Choose up to 10 minutes at a time for automatic captions. Your full recording stays available.');
  const decoded=await decodeSoundtrack(blob,new Offline(1,1,RATE),signal||new AbortController().signal,{allowSilent:true});
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  if(!decoded)throw new Error('This recording has no audio track.');
  return selectMonoAudio(decoded.buffer,{start,end,leadIn:decoded.leadIn});
}
