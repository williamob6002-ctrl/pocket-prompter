/** Local, real-time video trimming and burned-in captions. No network or dependencies. */
export class VideoProcessingError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'VideoProcessingError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

const FORMATS = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
];
const fail = (code, message, cause) => new VideoProcessingError(code, message, cause);

/** Capability check, not a guarantee that a particular file can be decoded/encoded. */
export function getVideoProcessingSupport(scope = globalThis) {
  const missing = [];
  if (!scope.document) missing.push('DOM');
  if (!scope.HTMLCanvasElement?.prototype?.captureStream) missing.push('canvas.captureStream');
  if (!scope.MediaRecorder) missing.push('MediaRecorder');
  if (!scope.MediaStream) missing.push('MediaStream');
  const Audio = scope.AudioContext || scope.webkitAudioContext;
  if (!Audio?.prototype?.createMediaElementSource || !Audio?.prototype?.createMediaStreamDestination) missing.push('Web Audio media routing');
  const formats = scope.MediaRecorder?.isTypeSupported
    ? FORMATS.filter(type => { try { return scope.MediaRecorder.isTypeSupported(type); } catch { return false; } })
    : [];
  return { supported: missing.length === 0, missing, formats, realTime: true };
}

export function normalizeCaptions(captions = []) {
  if (!Array.isArray(captions)) throw fail('INVALID_CAPTIONS', 'Captions must be an array.');
  return captions.map((cue, index) => {
    if (!cue || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start || typeof cue.text !== 'string' || !cue.text.trim()) {
      throw fail('INVALID_CAPTIONS', `Caption ${index + 1} needs text and valid start/end seconds.`);
    }
    return { start: cue.start, end: cue.end, text: cue.text.replace(/\r\n?/g, '\n').trim() };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Clip original-source cue times to the selected trim interval, then rebase to zero. */
export function trimCaptions(captions, start = 0, end = Infinity) {
  if (!Number.isFinite(start) || start < 0 || !(end > start)) throw fail('INVALID_RANGE', 'Caption trim range is invalid.');
  return normalizeCaptions(captions)
    .filter(cue => cue.end > start && cue.start < end)
    .map(cue => ({ start: Math.max(start, cue.start) - start, end: Math.min(end, cue.end) - start, text: cue.text }));
}

function srtTime(seconds) {
  const millis = Math.round(seconds * 1000);
  const pad = (value, count = 2) => String(value).padStart(count, '0');
  return `${pad(Math.floor(millis / 3600000))}:${pad(Math.floor(millis / 60000) % 60)}:${pad(Math.floor(millis / 1000) % 60)},${pad(millis % 1000, 3)}`;
}

export function toSrt(captions, { start = 0, end = Infinity } = {}) {
  return trimCaptions(captions, start, end).map((cue, i) => `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`).join('\n');
}

export function parseSrt(text) {
  if (typeof text !== 'string') throw fail('INVALID_CAPTIONS', 'SRT must be text.');
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n[ \t]*\n/);
  if (blocks.length === 1 && !blocks[0]) return [];
  const time = value => {
    const m = /^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value);
    if (!m || +m[2] > 59 || +m[3] > 59) throw fail('INVALID_CAPTIONS', `Invalid SRT timestamp: ${value}`);
    return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
  };
  return normalizeCaptions(blocks.map((block, i) => {
    const lines = block.split('\n');
    if (/^\d+$/.test(lines[0].trim())) lines.shift();
    const match = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(lines.shift() || '');
    if (!match) throw fail('INVALID_CAPTIONS', `Caption block ${i + 1} has no valid timing line.`);
    return { start: time(match[1]), end: time(match[2]), text: lines.join('\n') };
  }));
}

function abortError(signal) {
  return signal.reason instanceof VideoProcessingError ? signal.reason : fail('ABORTED', 'Video processing was cancelled.', signal.reason);
}

function checkAbort(signal) { if (signal.aborted) throw abortError(signal); }

function guarded(promise, signal, timeout = 20000, message = 'The browser took too long to process the video.') {
  return new Promise((resolve, reject) => {
    const done = (fn, value) => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); fn(value); };
    const onAbort = () => done(reject, abortError(signal));
    const timer = setTimeout(() => done(reject, fail('PROCESSING_FAILED', message)), timeout);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    Promise.resolve(promise).then(value => done(resolve, value), error => done(reject, error));
  });
}

function seek(video, seconds, signal) {
  checkAbort(signal);
  if (Math.abs(video.currentTime - seconds) < 0.001 && video.readyState >= 2 && !video.seeking) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); video.removeEventListener('seeked', success); video.removeEventListener('error', error); signal.removeEventListener('abort', abort); };
    const success = () => { cleanup(); resolve(); };
    const error = () => { cleanup(); reject(fail('SOURCE_UNREADABLE', 'The browser could not seek in this video.')); };
    const abort = () => { cleanup(); reject(abortError(signal)); };
    const timer = setTimeout(error, 15000);
    video.addEventListener('seeked', success, { once: true });
    video.addEventListener('error', error, { once: true });
    signal.addEventListener('abort', abort, { once: true });
    try { video.currentTime = seconds; } catch (cause) { cleanup(); reject(fail('SOURCE_UNREADABLE', 'This video cannot be trimmed by this browser.', cause)); }
  });
}

async function inspectOutput(blob, signal) {
  const media = document.createElement('video');
  media.preload = 'metadata';
  media.muted = true;
  media.playsInline = true;
  const url = URL.createObjectURL(blob);
  let removeListeners = () => {};
  try {
    const ready = new Promise((resolve, reject) => {
      const loaded = () => { removeListeners(); resolve(); };
      const error = () => { removeListeners(); reject(fail('PROCESSING_FAILED', 'The browser could not read its exported video.')); };
      removeListeners = () => { media.removeEventListener('loadedmetadata', loaded); media.removeEventListener('error', error); };
      media.addEventListener('loadedmetadata', loaded, { once: true });
      media.addEventListener('error', error, { once: true });
    });
    media.src = url;
    await guarded(ready, signal);
    if (!Number.isFinite(media.duration)) await seek(media, 1e10, signal);
    if (!Number.isFinite(media.duration) || media.duration <= 0) throw fail('DURATION_UNAVAILABLE', 'The browser could not verify the exported video’s length.');
    return { duration: media.duration, width: media.videoWidth, height: media.videoHeight };
  } finally {
    removeListeners(); media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url);
  }
}

function wrapText(context, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth) { line = candidate; continue; }
      if (line) lines.push(line);
      line = '';
      // Break a long URL or unspaced word rather than allowing it off-screen.
      for (const char of word) {
        if (line && context.measureText(line + char).width > maxWidth) { lines.push(line); line = char; }
        else line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawCaption(context, text, width, height) {
  const maxWidth = width * 0.86;
  const maxHeight = height * 0.72;
  let size = Math.max(16, Math.round(Math.min(width * 0.047, height * 0.07)));
  let lines;
  let fits = false;
  for (; size >= 8; size--) {
    context.font = `600 ${size}px system-ui, -apple-system, Arial, sans-serif`;
    lines = wrapText(context, text, maxWidth);
    if (lines.length * size * 1.25 <= maxHeight) { fits = true; break; }
  }
  if (!fits) throw fail('INVALID_CAPTIONS', 'A caption is too long to fit. Split it into shorter timed captions.');
  const lineHeight = size * 1.25;
  const padding = size * 0.48;
  const textWidth = Math.max(...lines.map(line => context.measureText(line).width));
  const bottom = height * 0.9;
  const top = bottom - lines.length * lineHeight;
  context.fillStyle = 'rgba(0, 0, 0, 0.78)';
  context.fillRect((width - textWidth) / 2 - padding, top - padding, textWidth + padding * 2, lines.length * lineHeight + padding * 2);
  context.fillStyle = '#fff';
  context.textAlign = 'center';
  context.textBaseline = 'top';
  lines.forEach((line, i) => context.fillText(line, width / 2, top + i * lineHeight));
}

/**
 * Call directly from a click/tap handler, before awaiting anything else.
 * start/end/caption times are seconds on the ORIGINAL video timeline.
 * Re-encodes at up to 30fps in real time. Keep the page visible and screen on.
 * Silent source videos receive a silent audio track; speech/music are never synthesised.
 */
export async function processVideo({ blob, start = 0, end, captions = [], aspect = 'original', logo, music, musicVolume = 0.15, signal, onProgress } = {}) {
  if (!(blob instanceof Blob) || blob.size === 0) throw fail('INVALID_INPUT', 'Choose a non-empty video file.');
  if (!Number.isFinite(start) || start < 0 || (end !== undefined && (!Number.isFinite(end) || end <= start))) throw fail('INVALID_RANGE', 'Trim end must be later than trim start.');
  const cues = normalizeCaptions(captions);
  if (!['original', '9:16', '16:9', '1:1'].includes(aspect)) throw fail('INVALID_INPUT', 'Choose original, portrait, landscape or square aspect.');
  if (logo !== undefined && (!(logo instanceof Blob) || logo.size === 0)) throw fail('INVALID_INPUT', 'The logo must be a non-empty image file.');
  if (music !== undefined && (!(music instanceof Blob) || music.size === 0)) throw fail('INVALID_INPUT', 'The music must be a non-empty audio file.');
  if (!Number.isFinite(musicVolume) || musicVolume < 0 || musicVolume > 1) throw fail('INVALID_INPUT', 'Music volume must be between 0 and 1.');
  const support = getVideoProcessingSupport();
  if (!support.supported) throw fail('UNSUPPORTED_API', `This browser cannot process videos locally: missing ${support.missing.join(', ')}.`);
  if (document.hidden) throw fail('INTERRUPTED', 'Keep this page open and visible while processing.');
  if (globalThis.navigator?.userActivation && !navigator.userActivation.isActive) throw fail('USER_GESTURE_REQUIRED', 'Tap the export button again to allow local video playback.');

  const controller = new AbortController();
  const localSignal = controller.signal;
  const forwardAbort = () => controller.abort(signal.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });
  const onVisibility = () => { if (document.hidden) controller.abort(fail('INTERRUPTED', 'Processing stopped because the app was hidden. Keep it open and try again.')); };
  document.addEventListener('visibilitychange', onVisibility);
  const emit = value => { try { onProgress?.(value); } catch { /* UI callbacks must not discard a finished take. */ } };
  let video, sourceUrl, audio, audioSource, audioDestination, canvasStream, outputStream, recorder;
  let musicElement, musicUrl, musicSource, musicGain, logoImage, logoUrl;
  let frame = 0, watchdog = 0;
  const cleanupCallbacks = [];

  try {
    checkAbort(localSignal);
    emit({ phase: 'preparing', progress: 0, elapsed: 0, duration: null });
    video = document.createElement('video');
    video.playsInline = true;
    video.preload = 'auto';
    video.muted = false;
    video.volume = 1;
    video.setAttribute('aria-hidden', 'true');
    video.setAttribute('playsinline', '');
    video.tabIndex = -1;
    // Do not use display:none: some browsers suspend decoding of hidden media.
    video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.001;pointer-events:none;z-index:-1;';
    document.body.appendChild(video);
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    audio = new Audio();
    audioSource = audio.createMediaElementSource(video);
    audioDestination = audio.createMediaStreamDestination();
    audioSource.connect(audioDestination); // Deliberately not connected to speakers.
    if (music) {
      musicElement = document.createElement('audio');
      musicElement.preload = 'auto';
      musicElement.loop = true;
      musicElement.setAttribute('aria-hidden', 'true');
      musicElement.style.display = 'none';
      document.body.appendChild(musicElement);
      musicSource = audio.createMediaElementSource(musicElement);
      musicGain = audio.createGain();
      musicGain.gain.value = musicVolume;
      musicSource.connect(musicGain);
      musicGain.connect(audioDestination);
      musicUrl = URL.createObjectURL(music);
      musicElement.src = musicUrl;
    }
    const resumed = audio.resume(); // Run both activation-sensitive calls before the first await.
    sourceUrl = URL.createObjectURL(blob);
    video.src = sourceUrl;
    const primed = video.play();
    const primedMusic = musicElement?.play();
    await guarded(Promise.all([resumed, primed, primedMusic]), localSignal);
    video.pause();
    musicElement?.pause();
    if (logo) {
      logoImage = new Image();
      if (typeof logoImage.decode !== 'function') throw fail('UNSUPPORTED_API', 'This browser does not provide the image decoder required for logo export.');
      logoUrl = URL.createObjectURL(logo);
      logoImage.src = logoUrl;
      try { await guarded(logoImage.decode(), localSignal); }
      catch (cause) { checkAbort(localSignal); throw fail('INVALID_INPUT', 'The browser could not read this logo image. Try a PNG or JPEG.', cause); }
      if (!logoImage.naturalWidth || !logoImage.naturalHeight) throw fail('INVALID_INPUT', 'The logo image has no dimensions.');
    }
    if (audio.state !== 'running') throw fail('USER_GESTURE_REQUIRED', 'The browser did not allow audio processing. Tap export again.');
    if (!video.videoWidth || !video.videoHeight) throw fail('SOURCE_UNREADABLE', 'The file has no decodable video track.');
    let duration = video.duration;
    // MediaRecorder WebM files can omit duration metadata; a far seek lets the decoder discover EOF.
    if (!Number.isFinite(duration)) {
      await seek(video, 1e10, localSignal);
      duration = Number.isFinite(video.duration) ? video.duration : video.currentTime;
    }
    if (!Number.isFinite(duration) || duration <= 0 || duration >= 1e9) throw fail('DURATION_UNAVAILABLE', 'The browser could not determine this video’s length.');
    const clipEnd = Math.min(end ?? duration, duration);
    if (start >= clipEnd || clipEnd - start < 0.1) throw fail('INVALID_RANGE', 'Choose a video range at least 0.1 seconds long.');
    const clipDuration = clipEnd - start;
    await seek(video, start, localSignal);
    if (musicElement) await seek(musicElement, 0, localSignal);
    const canvas = document.createElement('canvas');
    let cropWidth = video.videoWidth;
    let cropHeight = video.videoHeight;
    let outputWidth = video.videoWidth;
    let outputHeight = video.videoHeight;
    if (aspect !== 'original') {
      const [numerator, denominator] = aspect.split(':').map(Number);
      const ratio = numerator / denominator;
      if (cropWidth / cropHeight > ratio) cropWidth = cropHeight * ratio;
      else cropHeight = cropWidth / ratio;
      const factor = Math.floor(Math.min(video.videoWidth / numerator, video.videoHeight / denominator) / 2) * 2;
      if (factor < 2) throw fail('INVALID_INPUT', 'This video is too small for the selected crop.');
      outputWidth = numerator * factor;
      outputHeight = denominator * factor;
    }
    const cropX = (video.videoWidth - cropWidth) / 2;
    const cropY = (video.videoHeight - cropHeight) / 2;
    // Exact aspect and even encoder dimensions; original recordings retain their dimensions.
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw fail('UNSUPPORTED_API', 'This browser cannot create a video drawing surface.');
    const render = () => {
      context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
      if (logoImage) {
        const scale = Math.min(canvas.width * 0.22 / logoImage.naturalWidth, canvas.height * 0.15 / logoImage.naturalHeight);
        const width = logoImage.naturalWidth * scale;
        const height = logoImage.naturalHeight * scale;
        const gap = Math.min(canvas.width, canvas.height) * 0.035;
        context.drawImage(logoImage, canvas.width - width - gap, gap, width, height);
      }
      const active = cues.filter(cue => cue.start <= video.currentTime && cue.end > video.currentTime);
      if (active.length) drawCaption(context, active.map(cue => cue.text).join('\n'), canvas.width, canvas.height);
    };
    render();
    canvasStream = canvas.captureStream(30);
    outputStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioDestination.stream.getAudioTracks()]);
    if (!outputStream.getVideoTracks().length || !outputStream.getAudioTracks().length) throw fail('UNSUPPORTED_API', 'The browser could not capture the processed video and audio.');
    let lastConstructorError;
    // A successful feature probe is not sufficient: implementations may reject a stream/codec combination.
    for (const mimeType of [...support.formats, '']) {
      try { recorder = new MediaRecorder(outputStream, mimeType ? { mimeType } : {}); break; }
      catch (error) { lastConstructorError = error; }
    }
    if (!recorder) throw fail('UNSUPPORTED_FORMAT', 'This browser has no working local video encoder.', lastConstructorError);
    const chunks = [];
    let stopResolve, stopReject;
    const stopped = new Promise((resolve, reject) => { stopResolve = resolve; stopReject = reject; });
    stopped.catch(() => {}); // Recording can fail before the render loop has awaited stop.
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    recorder.onerror = event => {
      const error = fail('PROCESSING_FAILED', 'Video encoding failed. The original video is unchanged.', event.error);
      stopReject(error);
      controller.abort(error);
    };
    recorder.onstop = () => stopResolve();
    const beginTime = performance.now();
    let lastProgressTime = 0;
    let lastPosition = video.currentTime;
    let lastMovement = beginTime;
    let finishRequested = false;
    await new Promise((resolve, reject) => {
      const clean = () => {
        cancelAnimationFrame(frame); clearInterval(watchdog);
        localSignal.removeEventListener('abort', abort);
        video.removeEventListener('ended', finish);
        video.removeEventListener('error', sourceError);
        musicElement?.removeEventListener('error', sourceError);
      };
      const finish = () => {
        if (finishRequested) return;
        finishRequested = true;
        clean(); video.pause(); musicElement?.pause();
        try { if (recorder.state !== 'inactive') recorder.stop(); else stopResolve(); } catch (error) { reject(error); return; }
        resolve();
      };
      const abort = () => { clean(); reject(abortError(localSignal)); };
      const sourceError = () => { clean(); reject(fail('SOURCE_UNREADABLE', 'A media file stopped decoding before processing finished.')); };
      const tick = () => {
        if (localSignal.aborted) { abort(); return; }
        try {
          const now = performance.now();
          if (video.currentTime >= clipEnd - 0.005 || video.ended) { finish(); return; }
          render();
          if (Math.abs(video.currentTime - lastPosition) > 0.002) { lastPosition = video.currentTime; lastMovement = now; }
          if (now - lastProgressTime > 100) {
            emit({ phase: 'rendering', progress: Math.min(0.999, Math.max(0, (video.currentTime - start) / clipDuration)), elapsed: Math.max(0, video.currentTime - start), duration: clipDuration });
            lastProgressTime = now;
          }
          frame = requestAnimationFrame(tick);
        } catch (error) { clean(); reject(error); }
      };
      localSignal.addEventListener('abort', abort, { once: true });
      video.addEventListener('ended', finish, { once: true });
      video.addEventListener('error', sourceError, { once: true });
      musicElement?.addEventListener('error', sourceError, { once: true });
      cleanupCallbacks.push(clean);
      watchdog = setInterval(() => {
        if (performance.now() - lastMovement > 10000 || audio.state !== 'running') {
          controller.abort(fail('INTERRUPTED', 'Playback or audio processing was interrupted. Keep the screen awake and try again.'));
        }
      }, 500);
      try {
        checkAbort(localSignal);
        // Wait until source playback actually starts before starting the recorder.
        // WebKit can spend several hundred milliseconds starting audio after play().
        // Recording during that wait would insert silent/frozen padding into the output.
        Promise.resolve(video.play()).then(() => {
          if (finishRequested || localSignal.aborted) return;
          try {
            if (musicElement) Promise.resolve(musicElement.play()).catch(error => controller.abort(fail('PLAYBACK_FAILED', 'The browser could not play the selected background music.', error)));
            recorder.start(1000);
            render();
            lastMovement = performance.now();
            frame = requestAnimationFrame(tick);
          } catch (error) { clean(); reject(error); }
        }, error => {
          clean(); reject(fail(error.name === 'NotAllowedError' ? 'USER_GESTURE_REQUIRED' : 'PLAYBACK_FAILED', 'The browser could not start video playback. Tap export again.', error));
        });
      } catch (error) { clean(); reject(error); }
    });
    emit({ phase: 'finishing', progress: 1, elapsed: clipDuration, duration: clipDuration });
    await guarded(stopped, localSignal, 20000, 'The browser did not finish encoding the video.');
    checkAbort(localSignal);
    const mimeType = recorder.mimeType || chunks[0]?.type;
    if (!mimeType?.startsWith('video/')) throw fail('PROCESSING_FAILED', 'The browser did not identify a valid output video format.');
    const result = new Blob(chunks, { type: mimeType });
    if (!result.size) throw fail('PROCESSING_FAILED', 'The browser produced an empty video.');
    const verified = await inspectOutput(result, localSignal);
    if (Math.abs(verified.duration - clipDuration) > 0.2 || verified.width !== canvas.width || verified.height !== canvas.height) {
      throw fail('TIMING_UNRELIABLE', 'This browser could not reliably time this video export. Your original video is unchanged.');
    }
    emit({ phase: 'complete', progress: 1, elapsed: verified.duration, duration: verified.duration });
    return { blob: result, mimeType, ...verified };
  } catch (error) {
    if (localSignal.aborted) throw abortError(localSignal);
    if (error instanceof VideoProcessingError) throw error;
    if (error?.name === 'NotAllowedError') throw fail('USER_GESTURE_REQUIRED', 'Tap export again to allow local playback and audio processing.', error);
    if (error?.name === 'NotSupportedError') throw fail('UNSUPPORTED_FORMAT', 'This browser cannot decode or encode this video format.', error);
    throw fail('PROCESSING_FAILED', 'Local video processing failed. The original video is unchanged.', error);
  } finally {
    cleanupCallbacks.forEach(fn => fn());
    cancelAnimationFrame(frame); clearInterval(watchdog);
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch {} }
    if (recorder) { recorder.ondataavailable = null; recorder.onerror = null; recorder.onstop = null; }
    video?.pause();
    musicElement?.pause();
    outputStream?.getTracks().forEach(track => track.stop());
    canvasStream?.getTracks().forEach(track => track.stop());
    audioDestination?.stream.getTracks().forEach(track => track.stop());
    try { audioSource?.disconnect(); } catch {}
    try { musicSource?.disconnect(); } catch {}
    try { musicGain?.disconnect(); } catch {}
    try { audioDestination?.disconnect(); } catch {}
    if (audio && audio.state !== 'closed') { try { await audio.close(); } catch {} }
    if (video) { video.removeAttribute('src'); video.load(); video.remove(); }
    if (musicElement) { musicElement.removeAttribute('src'); musicElement.load(); musicElement.remove(); }
    if (logoImage) logoImage.removeAttribute('src');
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    if (musicUrl) URL.revokeObjectURL(musicUrl);
    if (logoUrl) URL.revokeObjectURL(logoUrl);
    signal?.removeEventListener('abort', forwardAbort);
    document.removeEventListener('visibilitychange', onVisibility);
  }
}
