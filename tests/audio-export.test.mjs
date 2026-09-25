import test from 'node:test';
import assert from 'node:assert/strict';
import {audioBufferToWav} from '../audio-export.js';
const buffer={sampleRate:4,numberOfChannels:2,length:4,duration:1,getChannelData(c){return Float32Array.from(c?[0,-1,.25,-.25]:[1,.5,-.5,-1]);}};
const samples=view=>Array.from({length:(view.byteLength-44)/2},(_,i)=>view.getInt16(44+i*2,true));
test('selected stereo interval has correct PCM header and interleaving',async()=>{
  const v=new DataView(await audioBufferToWav(buffer,{start:.25,end:.75}).arrayBuffer());
  assert.equal(v.byteLength,52);assert.equal(v.getUint16(22,true),2);assert.equal(v.getUint32(24,true),4);assert.equal(v.getUint32(40,true),8);
  assert.deepEqual(samples(v),[16384,-32768,-16384,8192]);
});
test('video timeline preserves leading silence and pads an explicit trailing selection',async()=>{
  const v=new DataView(await audioBufferToWav(buffer,{start:0,end:2,leadIn:.5}).arrayBuffer());
  assert.equal(v.byteLength,76);assert.deepEqual(samples(v),[0,0,0,0,32767,0,16384,-32768,-16384,8192,-32768,-8192,0,0,0,0]);
  const cropped=new DataView(await audioBufferToWav(buffer,{start:.75,end:1.25,leadIn:.5}).arrayBuffer());
  assert.deepEqual(samples(cropped),[16384,-32768,-16384,8192]);
});
test('reject invalid or oversized audio selections before allocating output',()=>{
  for(const range of [{start:0,end:0},{start:-1,end:1},{start:0,end:Infinity},{leadIn:-1}])assert.throws(()=>audioBufferToWav(buffer,range),/inside/);
  assert.throws(()=>audioBufferToWav(buffer,{start:0,end:1e12}),/too large/);
});
