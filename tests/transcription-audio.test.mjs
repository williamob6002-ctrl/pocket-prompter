import test from 'node:test';
import assert from 'node:assert/strict';
import {selectMonoAudio} from '../transcription-audio.js';

function fixture(channels){return {sampleRate:16000,duration:channels[0].length/16000,numberOfChannels:channels.length,getChannelData(c){return Float32Array.from(channels[c]);}};}
test('caption selection preserves source clock, delayed audio and stereo mix',()=>{
  const buffer=fixture([[.8,.4,-.4,-.8],[.2,.4,.2,-.2]]);
  const result=selectMonoAudio(buffer,{start:1/16000,end:7/16000,leadIn:3/16000});
  assert.equal(result.offset,1/16000);assert.equal(result.sampleRate,16000);
  const rounded=Array.from(result.audio,x=>Math.round(x*10)/10);
  assert.deepEqual(rounded,[0,0,.5,.4,-.1,-.5]);
});
test('silent gaps and out-of-audio trailing samples stay silent',()=>{
  const result=selectMonoAudio(fixture([[.5,.5]]),{start:0,end:5/16000,leadIn:2/16000});
  assert.deepEqual([...result.audio],[0,0,.5,.5,0]);
});
test('reject invalid selections and wrong sample rates before allocating audio',()=>{
  const buffer=fixture([[0,1]]);
  for(const range of [{start:-1,end:1},{start:0,end:0},{start:0,end:Infinity},{start:0,end:601}])assert.throws(()=>selectMonoAudio(buffer,range));
  assert.throws(()=>selectMonoAudio({...buffer,sampleRate:48000}),/16 kHz/);
});
