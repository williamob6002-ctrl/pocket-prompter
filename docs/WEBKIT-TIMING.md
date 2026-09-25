# WebKit video timing repair — 25 September 2026

This report covers the isolated timing candidate before the main app’s visual-effects integration. Final app checks are in ../VERIFICATION.md.

Timing candidate: `video-processing.js`; exact changes: `webkit-timing.patch`. No effects/main app/deploy edits were made in this workstream.

SHA-256: `3bd9717fb77cc927f2677ca957fca522427bf85f90f6debfc6abcdeddbcb3a16`.

## What was wrong and changed

The original `createMediaElementSource(video)` path produced a 4.952-second output for a 4.5-second trim. Actual decoded moving frames were roughly 430–457 ms behind their intended source timeline, while audio edges were about 120 ms late: this was an A/V content error, not only misleading duration metadata.

The replacement keeps the source video muted on its own playback clock and schedules decoded PCM through Web Audio. It preserves a simple MP4 leading empty edit, so deliberately delayed soundtracks stay delayed. Genuine silent MP4/WebM sources are identified before decoding and produce a zero-valued audio stream; a decode failure never silently discards an existing soundtrack. Music also uses a scheduled looping decoded buffer.

Recording starts on the first decoded post-seek video frame. Waiting for `play()` can lose the first second of a silent WebKit clip; starting at `seeked` can capture a stale pre-seek frame. The decoded frame callback avoids both. A tiny 1px, 1%-opacity decoder surface stays above the page because occluded WebKit video did not deliver its frame callback. Playback more than 150 ms late fails explicitly. The existing output dimension/duration guard remains unchanged (200 ms tolerance).

## Decoded evidence

The fixture is an 8-second 320×240/30fps video with a binary frame counter, visible numeric counter and moving bar. Its audio changes frequency every second (400, 500, …1100 Hz) and alternates 0.5-second tone/silence. `alignment-delayed.mp4` moves that soundtrack 0.6 seconds later. This detects content offsets and A/V drift, unlike a static frame or continuous single-frequency tone.

`alignment.mjs` exports through a real browser tap. `analyze-alignment.py` decodes output pixels and PCM with ffmpeg, reads actual source-frame counters, and measures tone edges/frequencies. Browser metadata and ffprobe container durations differ slightly on WebKit, so the table uses ffprobe. Signed video error is decoded source time minus intended source time at that output PTS.

| Final candidate export | Requested seconds | Actual container seconds | Sampled video error ms | First source frame seconds |
|---|---:|---:|---:|---:|
| WebKit audio trim | 4.500 | 4.572 | -67 to -30 | 1.267 |
| WebKit silent trim | 4.500 | 4.555 | -55 to -23 | 1.267 |
| WebKit from zero | 3.000 | 3.042 | -38 to -2 | 0.033 |
| WebKit delayed audio | 5.500 | 5.593 | -107 to -63 | 0.233 |
| WebKit longer with music/logo | 7.500 | 7.582 | -85 to -30 | 0.267 |
| Chromium audio trim | 4.500 | 4.482 | -17 to 37 | 1.233 |

For the standard WebKit trim (source 1.25–5.75), tone transitions are 40–50 ms late, versus video 30–67 ms late: relative A/V displacement stays within about 27 ms in the sampled fixture. The first decoded source frame is 1.267 s, not the stale 0 s frame. The silent export decodes to silence and has the correct first frame. The longer music/logo case remains stable through the end; its audio contains the expected changing source frequencies plus added music.

The delayed-track export (source 0.25–5.75) begins its first tone at output 0.390 s (expected 0.350 s plus codec padding); subsequent onsets remain 1.390, 2.390, … seconds. Chromium independently preserved the same delayed fixture: 5.515 s container duration, first tone 0.390 s and following onsets 1.390, 2.390 s. Thus the intended source delay survives, instead of being removed by full-file PCM decoding. Its source video and audio differ by at most roughly 67 ms in these samples.

Final `node --test video-processing.test.js`: 4/4 passed. `node smoke.mjs` and `node smoke.mjs --webkit`: all audio, silent, crop/logo/music, cancel and retry cases passed. `node verify-exports.mjs` decodes all six outputs and verifies the original 440 Hz tone, added 880 Hz music, silence, caption pixels, logo pixels, dimensions and near-2-second duration. Saved reports: `smoke-results.json`, `webkit-smoke-results.json`, `decoded-verification.json`.

## Limits that remain

- These are desktop Playwright Chromium/WebKit results, not physical iPhone/Safari evidence, lip-sync on human speech, long school recordings or upload acceptance.
- Processing remains real time, up to 30fps, with normal encoder padding and a few frames of trim tolerance. It is not lossless or frame/sample-accurate editing.
- Full-file source/music PCM decoding costs memory (~230 MB for ten-minute stereo 48 kHz audio). The native decode cannot be cancelled mid-operation; cancellation discards its result and cleans up. Large recordings need target-device testing.
- Complex MP4 edit lists fail explicitly. Arbitrary fragmented-container offsets, unusual WebM track offsets, multiple audio tracks and corrupt/truncated audio have not been established by this fixture set. This is not proof of arbitrary-container timeline support.
- `requestVideoFrameCallback` is now required. Unsupported APIs, late start, interrupted playback, decode/encode failure or unreliable output timing produce typed errors and preserve the original file.

## Source grounding

WebKit's recorder timestamps video from its audio recorder time; its historical media-element source issue also describes diverging media clocks: [encoder implementation](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/platform/mediarecorder/MediaRecorderPrivateEncoder.cpp), [WebKit issue 204228](https://bugs.webkit.org/show_bug.cgi?id=204228). The current task's decoded fixture reproduces the failure independently.

The replacement uses documented [full-file audio decoding](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData), [scheduled AudioBufferSource playback](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start), and [decoded video frame callbacks](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback). MP4 audio offset handling follows the [edit-list field layout](https://raw.githubusercontent.com/gpac/mp4box.js/main/src/boxes/elst.ts); codec priming is not added a second time.
