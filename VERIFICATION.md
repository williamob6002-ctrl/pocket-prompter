# Verification — Pocket Prompter 1.4.0

Updated 26 September 2026. This record distinguishes implemented features, tested browser behavior, and target-device work still needed.

## Version 1.4 checks

User feedback confirmed that a phone recording worked and downloaded as a file. The device model, iOS version, browser/installed mode and export button used have not been established. This is useful real-device recording evidence, not confirmation of Photos saving.

- **Photos/share correction:** video sharing now sends only the video File, with its actual container MIME and matching extension. Previously it included a title, which current WebKit adds as a separate native share item, and silently downloaded when sharing was unavailable. The revised Photos/share action never downloads as a fallback; Download file is separate. Cancellation and share errors preserve the take. The app explains that the user must choose Save Video and never claims to know the chosen destination. [WebKit implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/Cocoa/WKShareSheet.mm), [Web Share API](https://www.w3.org/TR/web-share/#share-method).
- **Integrated share checks:** 14 cases in each of Chromium and WebKit passed through the actual Takes UI with a real H.264/AAC MP4 and supplied native-share doubles. They verified identical video bytes, canonical MIME/filename, files-only payload, active user gesture, pending state, cancellation, errors, missing APIs, no silent download, explicit download, reopen persistence and stale-promise isolation. These checks do not exercise the physical iOS share sheet or Photos library.
- **School-project builder:** four guided forms arrange supplied notes into an editable script; they do not generate or verify facts. Fourteen workflow/failure cases in each browser passed: preview/revise/create/reload for each template, exact fact preservation, literal HTML text safety, separate scripts, note recovery across templates/reloads, whitespace-required validation, time-limit persistence, unlimited-time guidance and truthful quota-failure messages. Five independent module tests cover input limits, Unicode/newlines, omitted sections and timing/clarity advice.
- **Mobile presentation:** the script, builder, reader and take review were visually inspected at 390×844, 320×568, landscape and desktop sizes. Controls are at least 48 px; form text is at least 16 px to avoid small-input zoom. Practice and Record are visible without scrolling at 390×844; smaller screens can scroll. No horizontal overflow was observed. Camera-layout checks simulated the controls and do not establish physical camera performance.
- **Recording regression:** with the final app markup, desktop Chromium and WebKit completed record → pause → resume → finish → download → reload → reopen/play using generated moving video and an audio tone. Both exported H.264/AAC MP4 files of about 3.7 seconds with no application JavaScript errors. This confirms the integration retains the recording journey; it is not new physical-camera evidence.
- **Offline builder:** both browsers loaded a fresh document after the origin server rejected all HTTP, then completed notes → preview → script → two-minute target → reload. Script, target and original builder notes survived. The three new runtime modules came from the service-worker cache with matching hashes; no application network access, uploads or optional model downloads occurred. The release contains 224 mandatory offline assets.
- **Delivery boundary:** Save Video → Photos still requires confirmation on the user's iPhone. A web app cannot silently add media to Photos or identify the chosen native-share destination. Remaining paid-app differences in README/BENCHMARK still apply; this is not a claim of complete native-app parity or a measured quality grade.

## Earlier test-build handoff

Versions 1.2 and 1.3 were the first two functional releases after the request to finish within five rebuilds. A third publication updated documentation and its offline cache only. Version 1.4 is the fourth publication in that allowance, responding to the user's real-device feedback.

The published 1.3 files matched the release commit by SHA-256. A fresh desktop WebKit journey on the public URL downloaded the optional caption pack, transcribed actual speech from an MP4, and saved/reopened the captions. No application JavaScript errors, off-origin model requests or audio uploads were observed.

At the 1.3 handoff, further expansion was deferred pending target-device feedback. The user subsequently confirmed recording/file download and requested a better Photos experience and more useful school-project workflow. Version 1.4 addresses those areas. Remaining phone checks below are unresolved; complete paid-app parity is not claimed.

### Additional feasibility checks

- **Local AI writing:** the pinned SmolLM2-135M-Instruct ONNX candidate (revision `b8a5c0f183b78c55955a5364f610c36668b5e681`, 135,658,354-byte quantized weights) loaded and generated text in isolated Chromium. All three supplied-fact school-script cases failed quality: science output invented causality and omitted facts; a book review changed a family member and invented plot details; a recycling appeal repeated an instruction into the spoken output. It is excluded from the app. This rejects that candidate, not every possible local writing model. Larger-model phone memory, speed and usefulness remain unverified.
- **Network remote:** isolated WebRTC trials in Chromium and WebKit, including cross-browser and same-page controls, exchanged offers/answers but never established a data channel in this environment. Host candidates and a free STUN service were tried. This does not establish an iPhone platform prohibition. A dedicated remote remains unimplemented pending a successful real two-device connection and command/reconnection checks. Existing keyboard controls are unaffected.

## Version 1.3 checks

- Optional English automatic captions use a pinned, self-hosted 66,061,686-byte model/runtime pack. The normal offline installation excludes this pack. Each optional asset is size- and SHA-256-checked before caching; missing tools require an explicit download. All observed model/runtime HTTP requests remained on the app origin and used GET; there is no audio-upload endpoint or remote-model fallback.
- Actual human speech produced matching words and timed captions in desktop Chromium and WebKit, then repeated after a fresh reload while the origin refused every request. Independent synthetic school-speech checks included silence, background noise, leading pauses and chunk boundaries. Recognition and timing errors occurred, so captions remain editable drafts; this is not a child-speech accuracy guarantee.
- The isolated main-thread runtime passed 22 checks across the two browsers covering cancel/retry, disposal/reuse, partial-download recovery, missing offline assets and removing tools while preserving unrelated app caches. An earlier worker candidate crashed WebKit during teardown and is excluded from the shipped files.
- Responsiveness measurement on this Mac found individual encoder steps blocking the UI for about 1.0–1.3 seconds. Cancellation runs at the next model yield; it is not instantaneous. No iPhone speed, thermal or memory claim follows from desktop timings.
- Final app UI acceptance passed eight cases in each browser: assets remain opt-in; download cancel/retry; selected video speech becomes a dirty caption draft while outside cues remain; Keep/close/reload persists; cancelled recognition preserves previous text; fresh offline reload/transcription works; silent-video errors preserve the draft; removing tools leaves unrelated caches intact and missing offline tools fail clearly. WebKit used an isolated origin refusing every request because its automation offline switch independently fails even without ASR.
- Four delayed-metadata checks across the two browsers confirmed that typed end times and the Set end button survive late video metadata. Caption changes invalidate an older appearance preview. A cleanup-state race was fixed so the processing indicator stays visible until model-cache controls have refreshed.
- Actual MP4 audio preparation passed both browsers: mono 16 kHz, exact selected duration/source offset and preserved leading silence. Invalid source sizes/durations and oversized selections reject before opening an audio context; cancellation/retry preserves existing captions.

## Version 1.2 checks

- Caption persistence: 22 checks across Chromium and WebKit passed through the actual editor. Saved cues and chosen styles survive close/reload/reopen; style-only and text edits prompt before being discarded. Malformed SRT, injected quota errors and aborted IndexedDB writes preserve old data and allow retry. Saving a deleted take fails without recreating it. Real edited MP4 copies retain the caption style and correctly clipped/rebased timings.
- Legacy Word DOC importer: 36 checks passed in each browser through file input, isolated worker and rendered output. Three freshly generated Word 97–2003 documents preserve exact source body text, including multilingual text and 1,000 paragraphs. Twenty-one real Word fixtures produced readable text; this is not a full-fidelity claim. Nine malformed/unsupported variants fail clearly and a later valid import recovers. GDOC shortcuts give an export instruction; RTF with a DOC extension works.
- Final integrated DOC acceptance passed in both engines through the app file chooser: valid import, GDOC guidance, malformed input preserving the current script, successful retry and reload persistence. The same sequence passed after the origin HTTP server was stopped and confirmed unavailable. All 214 cached asset hashes matched the release files in both engines.
- The release adds four local offline dependencies for DOC extraction. Word 6/95, encrypted documents and unsupported complex files receive a DOCX/TXT fallback; headers, footnotes, text boxes and page layout are outside the supported DOC scope.
- At version 1.2, automatic transcription, additional AI models and dedicated network remotes were deferred. Version 1.3 subsequently added optional English transcription; the other items remain deferred.

## Version 1.1 checks

- Audio monitoring: 15 module checks, plus real WebAudio tone/silence checks in Chromium and WebKit. The monitor does not request another microphone, connect to speakers or stop shared recording tracks.
- Camera-mode app journey with synthetic moving canvas and tone: words stopped during silence while recording time continued; sound resumed scrolling; an explicit manual pause remained paused when sound returned; the MP4 take saved and reopened. Portrait (390×844) and landscape (844×390) controls were visually inspected.
- Independent WebKit fault injection: analyser failure paused words while the recorder kept recording. Resume rebuilt monitoring after a recoverable failure; a permanent failure offered the fixed-speed fallback, and the take remained saveable. This exposed and fixed a missing stream-reconnection path.
- Finish delay: automatic completion saved a short MP4. Chromium and WebKit cancellation checks confirmed that Pause cancels the finish timer and remains paused beyond its deadline. This exposed and fixed an incorrect Resume label/action during the finishing countdown.
- Frame-rate preferences: WebKit requested 30 then 60 fps, released both old tracks, retained both new tracks and saved a take. Settings were disabled throughout an active or paused take. Requested settings are preferences, not claims of actual hardware support.
- WAV: unit checks covered PCM header/interleaving, trimming and invalid ranges. Chromium and WebKit fixture exports produced exactly 2 seconds at 48 kHz. The actual WebKit editor download produced a 192,044-byte mono PCM WAV for a 0.5–2.5 second selection, with non-zero audio samples. Invalid ranges left the take available and re-enabled the button.
- Compositor module: 8 pixel/math checks plus 10 canvas checks in each Chromium/WebKit, including decoded PNG backgrounds, green/blue keying, text styling, source-time boundaries, wrapping, title/caption collision handling and cleanup.
- Actual mobile-width editor UI in Chromium and WebKit: a 0.5–2.5 second selection with title, large yellow captions, image background replacement, logo and square crop produced a downloaded edited video, which reopened and played. The original remained available. Preview-only combinations, malformed SRT and corrupt images produced the expected appearance or recoverable error without page errors or horizontal overflow.
- A full two-minute WebKit recording passed with the new monitor and silence assistance active: 60 seconds recording, a two-second pause, then 60 more seconds; save, download, reload, reopen and tail playback all succeeded. The file contains 320×240 H.264 video and stereo AAC audio, with roughly 120.2 seconds of media and non-zero sound; captured tracks were released. This used synthetic moving video and tone in real time, not physical phone capture.
- Final WAV UI checks also covered a silent video (explicit no-audio-track error) and a selection beyond the take (rejected). PCM export preserves simple MP4 leading audio delays and pads explicitly selected silent portions of the video timeline.
- Independent encoded-effects tests passed in Chromium and WebKit at 720p and 1080p: ten integrated cases covered decoded background/foreground/text pixels, source-time caption/title changes, audio pulse timing, invalid background, cancellation, retry and resource cleanup. Same-file playback in both target test browsers confirmed the rendered colours. One WebKit output had inconsistent stream/frame colour metadata: ffmpeg’s automatic interpretation shifted colour, while metadata-aware decoding matched WebKit playback. External players may interpret that browser-encoded file differently. These are desktop browser measurements, not physical iPhone performance claims.

## Confirmed in browser workflows

- Desktop Chromium and mobile-emulated WebKit each passed 20 script/reading checks: create/edit/save/reopen, duplicate/search, TXT/DOCX/PDF import, corrupt/image-only document errors, settings/mirroring, countdown cancellation, play/pause/seek/restart/speed, backup/download/restore, deduplication and invalid-backup preservation.
- Each engine passed eight offline checks: all service-worker assets cached; disconnected reload, script editing/persistence, reading/scrolling, new-script persistence, DOCX and fresh-worker PDF import. Chromium used browser offline mode. WebKit used a separate server rejecting every connection because its automation offline flag also breaks local File reads.
- Keyboard controls, looping and natural script completion passed.
- Importer module passed 26 checks in each engine, including generated real DOCX/PDF fixtures, export text preservation, file limits and bundled offline dependencies.
- Experimental voice module passed 20 alignment/lifecycle unit checks. Eleven targeted application regression checks covered voice denial/cleanup/resume/end, mirrors, corrupted storage, failed restoration saves, repeated Record taps, cancellation while preparing, countdown cancel and interrupted recording duration. Speech/recorder error lifecycle checks used controlled mocks, not a real child's voice.

## Recorded and exported media

Chromium and desktop WebKit were given their browser-provided synthetic camera/microphone sources, then exercised through the actual app UI: camera → record → pause → resume → finish → playback → download → close/reload → reopen saved take. Both passed without application JavaScript errors after fixing WebKit chunk persistence. The exported MP4s contain H.264 video and AAC audio, independently inspected with ffprobe. Synthetic capture does not establish a physical iPhone camera's quality or microphone sound.

The local editing module's Chromium exports were decoded and checked: source audio retained, added music frequency present only when chosen, correct square crop, visible burned-in captions and logo, cancellation and retry. The app's trim/caption journey also produced a playable edited MP4.

The Safari/WebKit timing error found in version 1.0 was repaired in 1.1. The source video now runs on its own muted playback clock, while decoded audio is scheduled separately; a decoded-frame callback establishes the start boundary. Tests used moving frame counters and changing tones, then decoded exported media with ffmpeg rather than relying only on browser metadata. A 4.5-second WebKit selection produced a 4.572-second container, with sampled video timing 30–67 ms late and audio transitions 40–50 ms late. Deliberately delayed MP4 soundtracks, silent input, music/logo, cancellation and retry also passed. Full evidence and limits are in [WEBKIT-TIMING.md](./docs/WEBKIT-TIMING.md).

This remains real-time re-encoding at up to 30 fps, with a few frames of trim tolerance and normal codec padding. Full-file PCM audio decoding uses memory; long/high-resolution recordings and physical iPhone performance remain unverified. Complex MP4 audio edit lists fail explicitly. The output duration/dimension guard remains active; a failed edit preserves the original.

## Visual and failure checks

Responsive script, reader, settings and recording views were inspected at phone and desktop sizes. Primary reading/recording actions are visible on a typical phone viewport; smaller displays can scroll the editor page. Reader controls support portrait and landscape. Native HTML controls and visible focus states are used; formal accessibility conformance has not been audited.

Corrupt saved data is preserved rather than overwritten. Quota-failed restores report session-only data. Camera denial has a recoverable explanation. Failed take storage offers immediate export. Closed/hidden app sessions stop recording and attempt to save supplied chunks. Force-killing the OS/browser can still lose a take.

## Remaining physical iPhone/iPad acceptance check

1. Open the public HTTPS link in Safari, Add to Home Screen, launch the new icon, and confirm offline readiness.
2. Create/import a school script in the installed app. Close/reopen and then launch without a connection; confirm it still reads and saves.
3. Record a two-minute front-camera take with spoken audio. Pause/resume once; replay it.
4. Share → Save Video (or Save to Files), then open that exported file in Photos/Files and the intended school submission destination.
5. Check portrait and landscape, screen-awake behavior, camera permissions and an interrupted take on that particular device.
6. Try optional voice following only after reviewing the browser-service notice. Its recognition quality and whether editing exports work are device-dependent.

No physical iPhone/iPad, Photos library or school upload account was available to the agent. The user subsequently confirmed recording and file download worked; other steps and the revised Photos flow have **not** been claimed as physically tested.

## Runtime and cost

The public app is a static site. It has no account system, subscriptions, billing code, advertising, analytics or paid API. Dependencies are bundled locally, including licenses. Optional speech recognition is supplied by the browser; the app does not run a paid recognition backend. GitHub Pages supplies the free HTTPS host, subject to its service availability/limits. The app's local storage has device/browser limits even though the app imposes no paid quotas or script-count limit.

## Offline release checks

Version 1.1 bundles 210 offline assets, including the new processing modules and linked guide/verification documents. Fresh Chromium and WebKit browser workflows exercised offline saved-script reading, DOCX/PDF import, WAV export, effects preview and edited-video download. Chromium used browser offline mode. WebKit used a separate origin that refused all requests after installation because its automation offline switch has a service-worker navigation failure. No application external uploads, analytics or payment paths were found; optional browser speech and user-initiated sharing remain separately disclosed.

## Published delivery

The public app is https://williamob6002-ctrl.github.io/pocket-prompter/, served by GitHub Pages from the main branch over enforced HTTPS. Source: https://github.com/williamob6002-ctrl/pocket-prompter. Version 1.4 updates install through the service worker: close every open app/Safari window for this site and reopen after an update is ready. Existing scripts and takes keep the same storage keys; no migration deletes them.
