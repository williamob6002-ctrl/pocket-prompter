# Pocket Prompter

A free teleprompter for iPhone/iPad Home Screen installation, with offline scripts and local video recording. No account, advertisements, payment code or watermark.

## Install and share

Open the published app link in Safari. Choose Share → Add to Home Screen, leave Open as Web App enabled if shown, then Add. Launch that icon once while online and check **Install & help → Ready for offline use**. Install before creating scripts; Safari and the installed app can use separate storage. The **Share app** button shares the public app URL, not scripts or recordings.

## Read and record

1. Create a script or import a document. Scripts save automatically on this device.
2. Choose **Practise reading** or **Record video**.
3. Use **Aa / Settings** to set text size, reading width, colours, mirroring, speed and countdown.
4. In recording mode allow both camera and microphone, then tap **Record**. The scrolling words are not included in the recording.
5. Pause pauses both the take and the words. Finish saves the take and opens playback. **Share / Save video** opens the system share sheet where supported; **Download** is the fallback.
6. Save important recordings in Photos or Files. Browser storage is not a permanent backup.

## Feature checklist

| Area | Included | Boundary |
|---|---|---|
| Scripts | Create, edit, autosave, search, duplicate, delete; bold/highlight cues; word/time estimate; text sharing; backup/restore | Stored on this device; no cloud account or live sync |
| Import | TXT, MD, DOCX, text PDF, basic RTF; iCloud/Files documents through the system picker | 15 MB per document; 200 PDF pages; 500,000 characters; no legacy DOC or OCR; complex RTF layouts may flatten |
| Reading | 40–300 words/min, touch seek, progress, pause/resume, restart, start/finish countdown, loop, timer | Speed is an average based on total script length and layout |
| Text | Size, font, colours, alignment, line spacing, width, reading guide; horizontal/vertical mirrors | Portrait/landscape follows device orientation |
| Controls | Touch, full-screen on supported browsers, keyboard and clickers emitting keyboard keys | No dedicated Watch app, hardware volume-button control or arbitrary Bluetooth protocol |
| Sound assistance | Live microphone level, adjustable silence threshold and hold time; waits during silence while video continues | Detects sound, not script words; noise can keep scrolling active; manual Pause still pauses both |
| Voice following | Experimental browser speech recognition with actual script-word matching | Practice only; browser availability varies; may send audio to provider and need internet; not offline PromptSmart parity |
| Recording | Front/back camera preference, microphone, pause/resume, multiple takes, 720p/1080p/4K and 24/25/30/60 fps preferences; device-exposed zoom/exposure/focus controls; MP4 preferred with WebM fallback | Actual format/resolution depends on device/browser; keep app open; no app-imposed duration limit, but device resources apply |
| Review/export | Local take library, playback, download, system file sharing and trimmed WAV audio export | Physical iPhone Photos/share destinations need target-device confirmation |
| Editing | Trim, centre crop, picture/logo, titles, background music mix, green/blue-screen replacement with colour or picture, appearance preview; creates separate copy | Exports run in real time, up to 30 fps, and must stay foreground. Choose original resolution, up to 1080p or 720p. Full-file audio decoding uses memory; long/high-resolution exports need a capable device. Timing and dimensions are checked before saving; a browser failure keeps the original. Browser-encoded colour metadata can be interpreted differently by other players. Chroma key needs an evenly lit coloured background; no beauty filters or advanced timeline |
| Captions | Import/edit SRT, estimated script drafts, trim-adjusted SRT export, burned-in captions with size, colour, position and background styling | Drafts are not speech-to-text; review wording and every timing; no automatic transcription |
| Offline/privacy | App shell, fonts/parsers, reading, editing and camera recording run locally; no analytics | Initial HTTPS download required; optional voice service and system sharing are external; the host receives normal page requests |
| Free sharing | Public HTTPS web app; free GitHub Pages hosting; no paid API/server | Hosting remains subject to GitHub's free service limits and availability |

**Not included:** AI script generation, AI eye-contact correction, automatic speech captions, text floating above other iPhone apps, cloud collaboration, proprietary remote apps or native camera features not exposed by the browser. These are explicit differences, not full parity with every paid teleprompter feature. See [BENCHMARK.md](./BENCHMARK.md) for sourced comparisons of Teleprompter for Video, PromptSmart Pro and BIGVU.

## Reliability and privacy

- Scripts and take chunks are stored locally; the app does not upload them.
- Recording data is written to IndexedDB during the take and retained for recovery after interruption where the browser supplies valid chunks. A force-quit or storage failure can still prevent a playable file. Save important takes externally.
- Leaving the app stops the take and attempts to save it. An incoming call or operating-system termination is outside the app's control.
- If storage fails, the app keeps a completed recording in memory long enough to offer immediate export. Closing that screen before exporting can lose the unsaved take.
- Clearing website data removes the local library. Use **Back up scripts** and save individual videos to Photos/Files. Backups do not contain video.
- Voice following is optional and off by default. Enabling it authorizes the browser's speech service, which may process microphone audio remotely. It is disabled during recording.
- Exported video is camera/microphone media only unless you deliberately apply captions, a picture or music in the editor.
- Video effects and sound/silence detection run locally and do not use the optional speech service.
- Use only music or pictures you have permission to include in the school project.

## Running and maintaining

Serve this directory over localhost or HTTPS. `npm start` serves locally at `http://127.0.0.1:4173`; there is no dependency installation or build step. Browsers require HTTPS (or localhost) for camera, microphone and service workers. Opening `index.html` as a local file is not supported.

`app.js` owns the UI and recording workflow; `storage.js` stores takes; `voice-follow.js` matches recognised speech to script words; `video-processing.js` performs local real-time video edits; `visual-effects.js` composites titles/captions/backgrounds; `audio-monitor.js` handles local sound levels; `audio-export.js` writes WAV files. Import libraries and their license notices are in `import-module/`. All runtime dependencies are bundled for offline use.

After changing runtime files, run `npm run check` and `npm run cache` to regenerate the service worker's asset list/version. The worker does not replace an active app session; close all windows and reopen to use the update.

## Validation

See [VERIFICATION.md](./VERIFICATION.md) for the tested version, browser journeys and the remaining physical-device checks. Browser emulation is not a claim that a physical iPhone was tested.

## Source and hosting

GitHub Pages is available for public repositories on GitHub Free: [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages). Apple documents Home Screen web app installation: [Apple iPhone guide](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios).
