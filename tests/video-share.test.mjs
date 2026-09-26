import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareVideoFile, canShareVideo, shareVideoFile } from '../video-share.js';

test('MP4 sharing strips codec parameters and preserves every original byte', async () => {
  const bytes = Uint8Array.of(0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50, 255);
  const file = prepareVideoFile(new Blob([bytes], { type: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2' }), 'My science video');
  assert.equal(file.type, 'video/mp4');
  assert.equal(file.name, 'My science video.mp4');
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
});

test('actual WebM remains WebM and filenames cannot inject paths or fake extensions', () => {
  const file = prepareVideoFile(new Blob(['webm'], { type: 'video/webm;codecs=vp8,opus' }), '../Ella’s project.mp4');
  assert.equal(file.type, 'video/webm');
  assert.equal(file.name, 'Ellas project.webm');
  assert.equal(prepareVideoFile(new Blob(['x'], { type: 'video/mp4' }), '???').name, 'My video.mp4');
  assert.equal(prepareVideoFile(new Blob(['x'], { type: 'video/mp4' }), 'Mia’s résumé').name, 'Mias résumé.mp4');
});

test('empty or unknown-format data is rejected rather than falsely labelled MP4', () => {
  assert.throws(() => prepareVideoFile(new Blob([], { type: 'video/mp4' })), TypeError);
  for (const type of ['', 'application/octet-stream', 'text/html']) {
    assert.throws(() => prepareVideoFile(new Blob(['x'], { type })), { name: 'NotSupportedError' });
  }
});

test('native share is invoked synchronously with the file only', async () => {
  const file = prepareVideoFile(new Blob(['x'], { type: 'video/mp4' }), 'Science');
  const calls = [];
  const completion = Promise.resolve();
  const nav = {
    canShare(payload) { assert.equal(this, nav); calls.push(['canShare', payload]); return true; },
    share(payload) { assert.equal(this, nav); calls.push(['share', payload]); return completion; },
  };
  const result = shareVideoFile(file, nav);
  assert.deepEqual(calls, [['canShare', { files: [file] }], ['share', { files: [file] }]]);
  assert.equal(result, completion);
  await result;
});

test('share is attempted when canShare is absent, and unsupported results never download', async () => {
  const file = prepareVideoFile(new Blob(['x'], { type: 'video/mp4' }));
  let calls = 0;
  const nav = { share: () => { calls++; return Promise.resolve(); } };
  assert.deepEqual(canShareVideo(file, nav), { supported: true });
  await shareVideoFile(file, nav);
  assert.equal(calls, 1);
  assert.equal(canShareVideo(file, {}).supported, false);
  assert.throws(() => shareVideoFile(file, {}), { name: 'NotSupportedError' });
  assert.throws(() => shareVideoFile(file, { canShare: () => false, share: () => calls++ }), { name: 'NotSupportedError' });
  assert.equal(calls, 1);
});

test('cancellation and native errors retain their identity for accurate UI handling', async () => {
  const file = prepareVideoFile(new Blob(['x'], { type: 'video/mp4' }));
  for (const name of ['AbortError', 'NotAllowedError', 'DataError']) {
    const error = new DOMException('Native share result', name);
    await assert.rejects(shareVideoFile(file, { share: () => Promise.reject(error) }), candidate => candidate === error);
  }
  const error = new Error('Capability check failed');
  assert.equal(canShareVideo(file, { share() {}, canShare() { throw error; } }).error, error);
});
