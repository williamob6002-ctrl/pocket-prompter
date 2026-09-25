import {decodeSoundtrack} from './video-processing.js';
/** Export the audio from a local take as uncompressed PCM WAV. No network. */
export function audioBufferToWav(buffer, {start=0,leadIn=0,end=buffer.duration+leadIn}={}) {
  const rate=buffer.sampleRate,channels=Math.min(2,buffer.numberOfChannels);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||!Number.isFinite(leadIn)||leadIn<0)throw new Error('Choose an audio selection inside the take.');
  const first=Math.floor(start*rate),last=Math.ceil(end*rate),frames=last-first,offsetFrames=Math.round(leadIn*rate);
  if(frames<=0||channels<1)throw new Error('This take has no audio in the selected interval.');
  const bytes=frames*channels*2;
  if(bytes>0xffffffff-44)throw new Error('The selected audio is too large for a WAV file. Choose a shorter selection.');
  const out=new ArrayBuffer(44+bytes),view=new DataView(out);
  const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,36+bytes,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,rate,true);view.setUint32(28,rate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,bytes,true);
  const samples=Array.from({length:channels},(_,channel)=>buffer.getChannelData(channel));let offset=44;
  for(let frame=first;frame<last;frame++)for(let channel=0;channel<channels;channel++){const sample=Math.max(-1,Math.min(1,samples[channel][frame-offsetFrames]||0));view.setInt16(offset,Math.round(sample*(sample<0?32768:32767)),true);offset+=2;}
  return new Blob([out],{type:'audio/wav'});
}
export async function exportAudio(blob, range={}) {
  const Offline=globalThis.OfflineAudioContext||globalThis.webkitOfflineAudioContext;
  if(!Offline)throw new Error('Audio export is unavailable in this browser. You can still save the original video.');
  if(!(blob instanceof Blob)||!blob.size)throw new Error('There is no recording to export.');
  const context=new Offline(2,1,48000);
  let decoded;
  try{decoded=await decodeSoundtrack(blob,context,new AbortController().signal,{allowSilent:true});}
  catch{throw new Error('This browser could not read the audio from this video. Keep the original video or try an up-to-date Safari.');}
  if(!decoded)throw new Error('This video does not contain an audio track.');
  return audioBufferToWav(decoded.buffer,{...range,leadIn:decoded.leadIn});
}
