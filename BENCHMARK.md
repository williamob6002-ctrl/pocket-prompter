# Teleprompter benchmark and free-distribution limits

Checked 25 September 2026 against current official product pages and App Store listings. This is a feature benchmark of three established products, not a verified ranking. Published features are vendor claims; none of these commercial apps was hands-on tested for this report.

**Decision:** a free, installable web app is a practical route to the school-project workflow: save a script, read it at a comfortable pace, record, then save/share the take. It is not honest to equate that with every feature across these three native products. Full parity includes video production, cloud services, native hardware integrations and speech processing.

## Feature matrix

“Unverified” means the reviewed sources do not establish the feature; it does not mean the app lacks it. Features can be paid, device-specific or version-specific.

| Capability | Teleprompter for Video | PromptSmart Pro | BIGVU |
|---|---|---|---|
| Scrolling control | Speed; pause/resume | VoiceTrack; fixed-speed modes | Speed; pause/resume |
| Voice behaviour | Voice-assisted scrolling | Tracks script; waits off-script | Detects silence and auto-pauses |
| Readability | Font size; rich text | Font, size, colours; margins | Unverified customisation details |
| Mirror for glass | Yes | Yes | Unverified |
| Start/finish countdown | Both | Unverified | Unverified |
| Script input | Edit; DOC/DOCX/TXT/RTF/PDF | Edit; DOCX/PDF/RTF/TXT/GDOC | Write/paste |
| Script cloud access | Dropbox/Drive/OneDrive/iCloud | Drive/OneDrive/Box/Dropbox/iCloud | Cloud projects/web access |
| Camera while reading | Front/rear; portrait/landscape | HD selfie; front/rear modes | Front/rear; multiple takes |
| Camera controls | Supported 4K/FPS; exposure/focus; zoom | Exposure/focus locks | Manual exposure; audio monitoring |
| Save/export | Video; SRT; MP4/MOV/audio | Photos; script export | Camera roll; cloud; social |
| Captions | Automatic; SRT; caption editor | Unverified | Automatic; editable/styled |
| Video editing | Trim/resize; logos/text/music; chroma key | Unverified | Crop; branding/music; chroma key; visual composition |
| Floating over other apps | Yes | Unverified | Unverified |
| Remote controls | Keyboard/Bluetooth/pedal/Watch/controller/web | Volume buttons; remote app/web | Controller support listed; exact controls unverified |
| AI extras | Script writer; eye-contact enhancement | Script generation listed in release notes | Eye contact; wider AI production suite |
| Free limitation | 750-character scripts; paid extras | Paid download; optional subscription | Free download; premium subscription |

Sources by column: [Teleprompter for Video App Store](https://apps.apple.com/us/app/teleprompter-for-video/id1139307843?platform=watch), [official support index](https://teleprompterforvideo.com/support), [official premium breakdown](https://teleprompterforvideo.com/support/what-upgrades-are-available); [PromptSmart Pro App Store](https://apps.apple.com/us/app/promptsmart-pro-teleprompter/id894811756), [PromptSmart help](https://promptsmart.com/help.html), [PromptSmart how it works](https://promptsmart.com/how-it-works.html); [BIGVU App Store](https://apps.apple.com/us/app/bigvu-teleprompter-captions-ai/id1124958568), [BIGVU mobile product page](https://bigvu.tv/tools/teleprompter-mobile-teleprompter-ios-android).

PromptSmart distinguishes genuine script-following speech recognition from simple sound/silence detection, and says its VoiceTrack audio is processed locally. A microphone amplitude gate should therefore be labelled **pause on silence**, not “voice tracking.” [PromptSmart how it works](https://promptsmart.com/how-it-works.html)

## What a completely free web app can credibly deliver

This table describes platform feasibility. The implemented and tested scope is recorded below and in VERIFICATION.md; physical iPhone acceptance remains open.

| Area | Feasible deliverable and measurable check | Remaining boundary |
|---|---|---|
| Distribution | Public HTTPS link; friend adds app to Home Screen and launches standalone | Home Screen installation is different from an App Store download; hosting free-tier terms require verification |
| Offline prompting | Open once online; then airplane-mode launch, edit, save, read and restart | Must cache every required asset and verify saved data persistence |
| Scripts | Create/rename/duplicate/delete, autosave, search; import TXT and structured backup; export/share | DOCX/PDF need separate parsers; scanned PDFs need OCR; cloud file picker is not cloud sync |
| Prompting | Adjustable font/spacing/margins/colours, mirror, orientation, speed, pause/resume, countdown, progress/timer, return to start | Check on an actual phone, not just a narrow desktop viewport |
| Recording | Camera and microphone permission; front/rear selection where exposed; record while prompting; replay | Secure HTTPS context and device capability determine support |
| Export | Save a playable take with audio; system share where supported; download fallback | Container/codec differs by browser; sharing needs capability detection |
| Controls | Touch and keyboard shortcuts, including remotes that emit keyboard keys | Does not establish Apple Watch, volume-button, arbitrary Bluetooth or foot-pedal parity |
| Voice assistance | Optional silence detection; experimental browser speech recognition if supported | Browser speech recognition is not universally available and may send audio to a service; offline speech-following parity cannot be promised |
| Captions | Editable script-based SRT with explicit estimated timings, or genuinely recorded timing data | Timed script text is not automatic transcription; burned-in captions need real rendering/export verification |
| Floating prompt | Prompt over the app's own camera view | Floating above other mobile apps is not a reliable cross-platform PWA promise |
| Cost/privacy | No account, no ads, no payment code, no paid API; local scripts/takes; explicit export/backup | A free public host is still an external dependency; device storage and browser deletion can affect data |

Official implementation evidence:

- Apple documents adding a website as an iPhone Home Screen web app. Installable PWAs use a manifest and secure origin; service workers can support offline operation. [Apple installation](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios), [MDN PWA installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [MDN offline operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)
- Camera/microphone capture needs permission and a secure context. MediaRecorder records the resulting stream. Recording formats must be checked with `MediaRecorder.isTypeSupported`; resource exhaustion can still cause failure. [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [MDN MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder), [MDN format detection](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static)
- Native share UI can accept files, but availability varies. [MDN Web Share](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API)
- SpeechRecognition has limited browser coverage; some implementations use remote processing and fail offline. [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
- Arbitrary HTML picture-in-picture is documented as a desktop Chrome feature; ordinary video picture-in-picture also has limited availability. These sources do not establish mobile cross-app teleprompter parity. [Chrome document PiP](https://developer.chrome.com/docs/web-platform/document-picture-in-picture), [MDN PiP](https://developer.mozilla.org/en-US/docs/Web/API/Picture-in-Picture_API)

## Pocket Prompter implementation status (1.3)

The app is published at https://williamob6002-ctrl.github.io/pocket-prompter/. All included functions are free; no subscription, account or paid API is involved.

| Benchmark area | App status | Practical limit |
|---|---|---|
| Library and document import | Implemented: autosave, search, duplicate, text sharing, JSON backup/restore, TXT/MD/DOC/DOCX/PDF/RTF | Files picker can reach cloud files; this is not live cloud synchronisation. Legacy DOC imports Word 97–2003 main-body text only. GDOC shortcuts explain how to export DOCX/TXT; direct Google-native document access and scanned PDF OCR are not included. |
| Reading and display | Implemented: speed, font/layout/colour, guide, mirrors, seek, timer, loop, start countdown | Check real-device orientation and comfortable eye line. |
| Voice assistance | Implemented: actual script-word matching in optional practice mode; local pause-on-silence in recording mode | Speech service varies by browser and may use the network. Sound detection does not follow words or ignore off-script speech. |
| Recording | Implemented: front/back preferences, quality/FPS preferences, exposed camera controls, microphone meter, pause/resume, optional finish delay | Browser chooses actual supported camera settings; app displays actual dimensions/FPS. Keep app foreground. |
| Media export | Implemented: video sharing/download, trimmed WAV audio, SRT | Physical Photos, Files and school-submission workflows remain to be checked on the target iPhone. |
| Local video editing | Implemented: trim, crop/size, music, logo, text title, styled captions, green/blue-screen background replacement, frame preview | Runs in real time on device; no multi-track timeline or automatic subject segmentation. Large videos/effects depend on device resources. |
| Remote controls | Keyboard and clickers that send supported keyboard keys | Apple Watch, hardware volume buttons and proprietary controllers need native integrations. A dedicated network remote is not implemented. |
| Automatic transcription | Implemented as an optional English-only local model; editable timed captions, offline after explicit ~66 MB download | Tested in desktop Chromium/WebKit. Words/timings can be wrong; child speech, iPhone memory/speed and interruption behavior remain unverified. Source under 100 MB/15 minutes; up to 10 minutes per selection. |
| AI script and eye-contact tools | Not implemented | These require additional models or services and separate device/quality validation. They are missing features, not a blanket claim of web impossibility. No paid service is silently substituted. |
| Floating text over other iPhone apps | Not implemented | A Home Screen web app has no general-purpose permission to draw arbitrary text over other apps. |
| Cloud projects/collaboration | Not implemented | Would introduce a server/account and ongoing storage/service dependency. Local backups and file sharing cover transfer between devices. |

Included extras run locally with bundled code, device APIs or explicitly downloaded models. Remaining model, server and native integrations are listed separately; this is not a claim of complete parity with every advertised feature or every paid-app subscription tier. See VERIFICATION.md for the actual evidence and remaining checks.

## Native iPhone distribution

Apple's standard Developer Program distribution costs **US$99 per membership year**, or the local equivalent. Eligible organisations can seek fee waivers. Free Personal Team access is for personal on-device testing and requires periodic reprovisioning; App IDs expire after seven days. Therefore, “free for the friend” is possible for an App Store app, but “no one pays anything, permanently installable, normal App Store sharing” is not the standard individual-developer path. [Apple membership comparison](https://developer.apple.com/support/compare-memberships/)

## Acceptance priorities for this friend

1. Friend receives one link, installs at no cost and understands where scripts/takes are stored.
2. A multi-minute school script is created or imported, survives closing the app and works offline.
3. Reading speed, text size, pause/resume, countdown and restart work on the target phone in both orientations.
4. If recording is needed: complete a multi-minute front-camera take with audible sound, replay it, export it, and open the exported file in the intended school submission/share workflow.
5. Permission denied, unsupported recording/speech APIs, interrupted recording and limited storage produce clear recoverable outcomes without losing the script or completed take.
6. Benchmark each advanced feature separately as implemented, unsupported, or unverified. Do not label a useful free core app as full feature parity.
