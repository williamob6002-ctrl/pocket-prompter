# Local English caption tools

Optional self-hosted speech recognition. No inference API, audio upload, account, subscription or remote-model fallback. Users opt into a **66,061,686-byte (~66 MB)** download; the main app's initial offline install excludes these assets. Every asset is checked against the sizes and SHA-256 hashes in `asset-manifest.js` before it is cached in `pp-asr-v1-t381-tinyen-aeaa137`.

## Pinned dependencies and notices

- [Transformers.js 3.8.1](https://www.npmjs.com/package/@huggingface/transformers/v/3.8.1), Apache-2.0; full licence: `vendor/LICENSE-transformers.txt`. The official npm package supplies `transformers.min.js` **and its matching** `ort-wasm-simd-threaded.jsep.mjs` / `.wasm` files. Its declared ONNX Runtime Web version is `1.22.0-dev.20250409-89f8206ba4`. Do not substitute a different WASM build.
- [ONNX Runtime](https://github.com/microsoft/onnxruntime), MIT; full licence: `vendor/LICENSE-onnxruntime.txt`.
- [Timestamped Whisper tiny English ONNX weights](https://huggingface.co/onnx-community/whisper-tiny.en_timestamped/tree/aeaa13760958b03fac5062f457d317d3319c3168), pinned revision `aeaa13760958b03fac5062f457d317d3319c3168`. Only the quantized encoder and merged decoder are packaged: **40,826,993 bytes** together. Remaining model files are configuration/tokenizer assets.
- Original [OpenAI Whisper](https://github.com/openai/whisper) weights/code are MIT-licensed; full licence: `models/LICENSE-whisper.txt`. The converted repository identifies `openai/whisper-tiny.en` as its base model. No model weights were trained or modified for this app.

## Runtime and limits

`local-asr.js` exports `createLocalTranscriber()`: `getStatus`, `prepare`, `transcribe`, `dispose`, `clearCache`. `asr-engine.js` uses single-threaded **main-thread WASM**, yielding between model steps for UI/cancellation. A worker approach was rejected after a reproducible desktop WebKit crash on worker teardown. No WebGPU or cross-origin isolation is required.

Input is mono 16 kHz Float32 audio, maximum 600 seconds per selected section. Windows use 30 seconds with overlap; returned captions have zero-based times relative to that input. Silence gives no captions. Other audio can still produce mistakes: results are editable drafts. Review wording and timing, especially names, numbers, accents, background noise and leading pauses.

Desktop Chromium and WebKit passed real-human transcription and fresh-page offline transcription with all origin requests refused. Independent desktop tests also passed cancel/reuse, completed disposal/reuse, interrupted-download retry, silence, overlapping-window boundary speech, and cache removal while preserving unrelated caches. Main-thread heartbeat gaps reached about 1.0–1.3 seconds during encoder work on this Mac; Cancel responds after the current model step. Physical iPhone speed, memory use, thermal behavior, background interruption and child-speech accuracy remain unverified. No desktop timing is an iPhone speed guarantee. Browser storage can be evicted; users can inspect status, remove the tools or explicitly download them again.

See `HANDOFF.md` for integration details and the required service-worker optional-cache lookup. Core precache: `local-asr.js`, `asr-engine.js`, `asset-manifest.js`; optionally these small documentation files. Exclude `vendor/` and `models/` from mandatory precache.
