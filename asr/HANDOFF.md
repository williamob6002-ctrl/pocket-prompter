# Optional local English automatic captions

Desktop Chromium and WebKit both transcribed the official Transformers.js documentation's real-human 11-second JFK speech sample accurately, including after a fresh page reload with the server refusing every request. Physical iPhone verification remains outstanding. The original worker implementation crashed desktop WebKit during teardown and must NOT be shipped. This candidate uses main-thread WASM with task yielding instead.

## Files to deliver

Copy `local-asr.js`, `asr-engine.js`, `asset-manifest.js`, `vendor/`, and `models/` into the application's `asr/` directory. Core service-worker precaching should include only the three small JS files. Never add vendor/model files to the mandatory offline install. The optional asset pack totals **66,061,686 bytes** (~66.1 MB decimal; 63.0 MiB), including licences.

The engine uses single-threaded main-thread WASM, no WebGPU, no cross-origin isolation requirement, no remote model fallback, and no audio-upload API. Its model download is requested only by an explicit `prepare()` call. Inputs are mono Float32 PCM at 16 kHz. Caller should decode a selected portion and add that portion's original start time to returned caption timestamps. The module's timestamps start at zero. It yields the main thread before each model forward step so UI events/cancellation can run. Inference still occupies the main thread during an individual WASM step; mobile responsiveness must be measured on a real phone.

## API

```js
import {createLocalTranscriber} from './asr/local-asr.js';
const captions = createLocalTranscriber();
await captions.getStatus();
// {prepared, downloadedBytes, totalBytes, missing: string[], cacheName}
await captions.prepare({signal, onProgress}); // explicit opt-in download, then load
const result = await captions.transcribe({audio, sampleRate:16000, signal, onProgress});
// {text, captions:[{start,end,text}], language:'en', reason?:'silence'|'nothing-recognized'}
captions.dispose(); // cancel and schedule safe model disposal; instance remains reusable
await captions.clearCache(); // cancel, dispose and delete optional downloads
```

`onProgress` receives `{phase:'downloading'|'loading'|'transcribing',progress:0..1,loaded?,total?,file?,completedSeconds?,totalSeconds?}`. There is at most one operation per instance. Cancellation returns AbortError and produces no partial captions. It cooperatively stops computation at the next yielded model step and disposes the model. A new engine waits for the old engine to finish disposing before loading. Do not promise instantaneous compute interruption on physical phones. A cancelled download retains already verified complete assets for a later retry. Do not clear its cache during an active download; cancel first.

Validation errors have `.code` values such as `NOT_PREPARED`, `INVALID_AUDIO`, `AUDIO_TOO_LONG`, `UNSUPPORTED`, `BUSY`, `DOWNLOAD_FAILED`, `INCOMPLETE_DOWNLOAD`, or `INTEGRITY_FAILED`. `transcribe()` never invokes `prepare()` or downloads a missing model automatically. Empty/near-zero sound returns no captions; this is a conservative silence check, not reliable speech detection for noisy audio.

Maximum input: 600 seconds. Audio is processed using 30-second overlapping windows and word timestamps, keeping the words whose centres fall inside each 20-second core. Captions group up to seven words/about four seconds. This bounds inference windows; the caller's decoded PCM and any source-video decode still consume additional memory. The 10-minute guard is a resource limit, not a claim that a 10-minute physical-iPhone test passed. Desktop school-speech tests measured heartbeat gaps of about 1.0–1.3 seconds during individual encoder steps. Cancellation is cooperative and may respond slowly on a phone.

## Required service-worker lookup

After the main-cache lookup and before falling back to fetch, serve optional cached assets for requests under the app's `asr/` URL prefix:

```js
if (new URL(event.request.url).pathname.startsWith(new URL('./asr/',self.location).pathname)) {
  const optional = await caches.open('pp-asr-v1-t381-tinyen-aeaa137');
  const saved = await optional.match(event.request);
  if (saved) return saved;
}
```

Preserve the separate `pp-asr-` namespace during ordinary app-cache cleanup. Serve `.mjs` as JavaScript and `.wasm` as `application/wasm`. The download manager checks each packaged file's byte count and SHA-256 before caching it. Browser storage can be cleared or evicted: display `getStatus()` and allow another explicit download.

## Pinned provenance

- Transformers.js **3.8.1**, official npm package `@huggingface/transformers`. `vendor/transformers.min.js` and both `ort-wasm-simd-threaded.jsep` files come from the *same package's dist directory*. Its declared ORT dependency is `1.22.0-dev.20250409-89f8206ba4`. Do not mix a different ORT JS/WASM build.
- Model: `onnx-community/whisper-tiny.en_timestamped`, revision `aeaa13760958b03fac5062f457d317d3319c3168`, from `https://huggingface.co/onnx-community/whisper-tiny.en_timestamped/tree/aeaa13760958b03fac5062f457d317d3319c3168`. Selected quantized encoder + merged decoder are 40,826,993 bytes. Tokenizer and five configuration/tokenizer files are included; unused precision variants are excluded.
- Base model: OpenAI Whisper tiny English. Upstream OpenAI Whisper MIT licence, ONNX Runtime MIT licence and Transformers.js Apache-2.0 licence are included. Converted model repository attributes the weights to `openai/whisper-tiny.en`.
- Human-speech QA fixture only (not shipped): `https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav`; expected transcript comes from the official Transformers.js ASR documentation. Synthetic school speech has a separate independent QA note and is not evidence of child-speech accuracy.

## Product wording and limits

“Download optional English caption tools (~66 MB). Speech is processed on this device. Review every caption: names, accents, noise and pauses can cause mistakes. Keep the app open while processing.”

No subscription/API charge/account or inference service is required. Model accuracy is not guaranteed. Physical iPhone performance, memory, thermal behavior and Home Screen background interruption remain unverified; desktop WebKit is not an iPhone. No speed promise should be based on the desktop timings. Captions are editable drafts: independent school-speech testing found recognition and leading-silence timing errors even with clean synthetic speech.
