# Verification — Pocket Prompter 1.0.0

Checked 25 September 2026. This record distinguishes implemented features, tested browser behavior, and target-device work still needed.

## Confirmed in browser workflows

- Desktop Chromium and mobile-emulated WebKit each passed 20 script/reading checks: create/edit/save/reopen, duplicate/search, TXT/DOCX/PDF import, corrupt/image-only document errors, settings/mirroring, countdown cancellation, play/pause/seek/restart/speed, backup/download/restore, deduplication and invalid-backup preservation.
- Each engine passed eight offline checks: all service-worker assets cached; disconnected reload, script editing/persistence, reading/scrolling, new-script persistence, DOCX and fresh-worker PDF import. Chromium used browser offline mode. WebKit used a separate server rejecting every connection because its automation offline flag also breaks local File reads.
- Keyboard controls, looping and natural script completion passed.
- Importer module passed 26 checks in each engine, including generated real DOCX/PDF fixtures, export text preservation, file limits and bundled offline dependencies.
- Experimental voice module passed 20 alignment/lifecycle unit checks. Eleven targeted application regression checks covered voice denial/cleanup/resume/end, mirrors, corrupted storage, failed restoration saves, repeated Record taps, cancellation while preparing, countdown cancel and interrupted recording duration. Speech/recorder error lifecycle checks used controlled mocks, not a real child's voice.

## Recorded and exported media

Chromium and desktop WebKit were given their browser-provided synthetic camera/microphone sources, then exercised through the actual app UI: camera → record → pause → resume → finish → playback → download → close/reload → reopen saved take. Both passed without application JavaScript errors after fixing WebKit chunk persistence. The exported MP4s contain H.264 video and AAC audio, independently inspected with ffprobe. Synthetic capture does not establish a physical iPhone camera's quality or microphone sound.

The local editing module's Chromium exports were decoded and checked: source audio retained, added music frequency present only when chosen, correct square crop, visible burned-in captions and logo, cancellation and retry. The app's trim/caption journey also produced a playable edited MP4.

**Known Safari/WebKit limitation:** some local edited exports gained roughly half a second of startup padding. The module reopens each output and checks timing/dimensions, rejecting these with a clear message instead of reporting success. Original recordings remain available. Silent test exports passed in WebKit; audio editing on the real target iPhone is unverified and may be unavailable. This is not claimed as native-editor parity.

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

No physical iPhone/iPad, Photos library or school upload account was available during this run. These steps have **not** been claimed as tested.

## Runtime and cost

The public app is a static site. It has no account system, subscriptions, billing code, advertising, analytics or paid API. Dependencies are bundled locally, including licenses. Optional speech recognition is supplied by the browser; the app does not run a paid recognition backend. GitHub Pages supplies the free HTTPS host, subject to its service availability/limits. The app's local storage has device/browser limits even though the app imposes no paid quotas or script-count limit.
