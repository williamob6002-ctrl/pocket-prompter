import {createCompositor} from './visual-effects.js';
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
  if (!scope.HTMLVideoElement?.prototype?.requestVideoFrameCallback) missing.push('decoded video frame callbacks');
  const Audio = scope.AudioContext || scope.webkitAudioContext;
  if (!Audio?.prototype?.decodeAudioData || !Audio?.prototype?.createBufferSource || !Audio?.prototype?.createMediaStreamDestination) missing.push('Web Audio decoding and recording');
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

// Identify genuinely silent MP4/MOV/WebM inputs before decoding. A decode failure
// must never be interpreted as permission to discard an existing soundtrack.
function containerHasAudio(buffer, timeline = {}) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const text = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  function boxes(begin, end) {
    const result = [];
    for (let offset = begin; offset + 8 <= end;) {
      let size = view.getUint32(offset), header = 8;
      if (size === 1) {
        if (offset + 16 > end) return null;
        size = view.getUint32(offset + 8) * 4294967296 + view.getUint32(offset + 12); header = 16;
      } else if (size === 0) size = end - offset;
      if (!Number.isSafeInteger(size) || size < header || offset + size > end) return null;
      result.push({ type: text(offset + 4, 4), begin: offset + header, end: offset + size });
      offset += size;
    }
    return result;
  }
  const top = boxes(0, bytes.length);
  const moov = top?.find(box => box.type === 'moov');
  if (moov) {
    const movieBoxes = boxes(moov.begin, moov.end);
    const tracks = movieBoxes?.filter(box => box.type === 'trak');
    if (!tracks?.length) return null;
    let unknown = false;
    for (const track of tracks) {
      const media = boxes(track.begin, track.end)?.find(box => box.type === 'mdia');
      const handler = media && boxes(media.begin, media.end)?.find(box => box.type === 'hdlr');
      if (!handler || handler.end - handler.begin < 12) { unknown = true; continue; }
      if (text(handler.begin + 8, 4) === 'soun') {
        const edits = boxes(track.begin, track.end)?.find(box => box.type === 'edts');
        const editList = edits && boxes(edits.begin, edits.end)?.find(box => box.type === 'elst');
        timeline.leadIn = 0;
        if (editList) {
          const movieHeader = movieBoxes?.find(box => box.type === 'mvhd');
          const clockOffset = movieHeader && (bytes[movieHeader.begin] === 1 ? 20 : 12);
          if (!movieHeader || movieHeader.begin + clockOffset + 4 > movieHeader.end || editList.begin + 8 > editList.end) throw fail('UNSUPPORTED_FORMAT', 'This video has an unreadable audio edit timeline.');
          const timescale = view.getUint32(movieHeader.begin + clockOffset);
          const version = bytes[editList.begin], count = view.getUint32(editList.begin + 4);
          const entrySize = version === 0 ? 12 : version === 1 ? 20 : 0;
          if (!timescale || !entrySize || editList.begin + 8 + count * entrySize > editList.end) throw fail('UNSUPPORTED_FORMAT', 'This video has an unsupported audio edit timeline.');
          let contentSeen = false;
          for (let i = 0; i < count; i++) {
            const offset = editList.begin + 8 + i * entrySize;
            const duration = version === 0 ? view.getUint32(offset) : view.getUint32(offset) * 4294967296 + view.getUint32(offset + 4);
            const mediaOffset = offset + (version === 0 ? 4 : 8);
            const mediaTime = version === 0 ? view.getInt32(mediaOffset) : view.getInt32(mediaOffset) * 4294967296 + view.getUint32(mediaOffset + 4);
            const rateOffset = offset + entrySize - 4;
            if (!Number.isSafeInteger(duration) || !Number.isSafeInteger(mediaTime) || view.getInt16(rateOffset) !== 1 || view.getInt16(rateOffset + 2) !== 0 || contentSeen) throw fail('UNSUPPORTED_FORMAT', 'Videos with complex audio edit lists cannot be edited in this browser.');
            if (mediaTime === -1) timeline.leadIn += duration / timescale;
            else { if (mediaTime < 0) throw fail('UNSUPPORTED_FORMAT', 'This audio timeline is unsupported.'); contentSeen = true; }
          }
          if (!contentSeen) return false;
        }
        return true;
      }
    }
    return unknown ? null : false;
  }
  if (bytes.length < 4 || view.getUint32(0) !== 0x1a45dfa3) return null;
  function vint(offset, identifier) {
    const first = bytes[offset];
    if (!first) return null;
    let mask = 128, length = 1;
    while (!(first & mask)) { mask >>= 1; length++; }
    if (offset + length > bytes.length || (identifier && length > 4)) return null;
    let value = identifier ? first : first & (mask - 1);
    let unknown = !identifier && value === mask - 1;
    for (let i = 1; i < length; i++) { value = value * 256 + bytes[offset + i]; unknown = unknown && bytes[offset + i] === 255; }
    if (!unknown && !Number.isSafeInteger(value)) return null;
    return { value, length, unknown };
  }
  function elements(begin, end) {
    const result = [];
    for (let offset = begin; offset < end;) {
      const id = vint(offset, true); if (!id) return null;
      const size = vint(offset + id.length, false); if (!size) return null;
      const content = offset + id.length + size.length;
      const finish = size.unknown ? end : content + size.value;
      if (finish > end || finish <= offset) return null;
      result.push({ id: id.value, begin: content, end: finish }); offset = finish;
    }
    return result;
  }
  const segment = elements(0, bytes.length)?.find(element => element.id === 0x18538067);
  const tracks = segment && elements(segment.begin, segment.end)?.find(element => element.id === 0x1654ae6b);
  if (!tracks) return null;
  const entries = elements(tracks.begin, tracks.end)?.filter(element => element.id === 0xae);
  if (!entries?.length) return null;
  let unknown = false;
  for (const entry of entries) {
    const type = elements(entry.begin, entry.end)?.find(element => element.id === 0x83);
    if (!type || type.end - type.begin < 1 || type.end - type.begin > 8) { unknown = true; continue; }
    let value = 0;
    for (let i = type.begin; i < type.end; i++) value = value * 256 + bytes[i];
    if (!Number.isSafeInteger(value)) { unknown = true; continue; }
    if (value === 2) return true;
  }
  return unknown ? null : false;
}

export async function decodeSoundtrack(blob, audio, signal, { allowSilent = false } = {}) {
  const bytes = await guarded(blob.arrayBuffer(), signal);
  const timeline = { leadIn: 0 };
  const presence = allowSilent ? containerHasAudio(bytes, timeline) : true;
  if (presence === false) return null;
  try {
    const buffer = await guarded(audio.decodeAudioData(bytes), signal, 60000, 'Audio decoding took too long for this device.');
    return { buffer, leadIn: timeline.leadIn };
  }
  catch (cause) {
    checkAbort(signal);
    if (cause instanceof VideoProcessingError) throw cause;
    throw fail('UNSUPPORTED_FORMAT', 'This browser could not decode the soundtrack for editing. Your original video is unchanged.', cause);
  }
}

/**
 * Call directly from a click/tap handler, before awaiting anything else.
 * start/end/caption times are seconds on the ORIGINAL video timeline.
 * Re-encodes at up to 30fps in real time. Keep the page visible and screen on.
 * Silent source videos receive a silent audio track; speech/music are never synthesised.
 */
export async function processVideo({ blob, start = 0, end, captions = [], aspect = 'original', maxEdge = 0, title = {}, captionStyle = {}, chroma = {}, background, logo, music, musicVolume = 0.15, signal, onProgress } = {}) {
  if (!(blob instanceof Blob) || blob.size === 0) throw fail('INVALID_INPUT', 'Choose a non-empty video file.');
  if (!Number.isFinite(start) || start < 0 || (end !== undefined && (!Number.isFinite(end) || end <= start))) throw fail('INVALID_RANGE', 'Trim end must be later than trim start.');
  const cues = normalizeCaptions(captions);
  if (!['original', '9:16', '16:9', '1:1'].includes(aspect)) throw fail('INVALID_INPUT', 'Choose original, portrait, landscape or square aspect.');
  if (![0,1280,1920].includes(maxEdge)) throw fail('INVALID_INPUT', 'Choose original, 1080p or 720p output size.');
  if (background !== undefined && (!(background instanceof Blob) || background.size === 0)) throw fail('INVALID_INPUT', 'The background must be a non-empty image.');
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
  let musicSource, musicGain, logoImage, logoUrl, backgroundImage, backgroundUrl, compositor;
  let frame = 0, decodedFrame = 0, watchdog = 0;
  const cleanupCallbacks = [];

  try {
    checkAbort(localSignal);
    emit({ phase: 'preparing', progress: 0, elapsed: 0, duration: null });
    video = document.createElement('video');
    video.playsInline = true;
    video.preload = 'auto';
    video.muted = true;
    video.volume = 1;
    video.setAttribute('aria-hidden', 'true');
    video.setAttribute('playsinline', '');
    video.tabIndex = -1;
    // Keep a tiny unobscured decoder surface. WebKit does not deliver decoded-frame
    // callbacks for display:none or a video occluded behind the page (z-index:-1).
    video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:2147483647;';
    document.body.appendChild(video);
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    audio = new Audio();
    audioDestination = audio.createMediaStreamDestination();
    // Keep the video decoder on its own muted playback clock. In WebKit,
    // createMediaElementSource(video) can stall its displayed frame clock while
    // audio keeps running. Scheduled decoded audio avoids that A/V divergence.
    const resumed = audio.resume(); // Run both activation-sensitive calls before the first await.
    sourceUrl = URL.createObjectURL(blob);
    video.src = sourceUrl;
    const primed = video.play();
    await guarded(Promise.all([resumed, primed]), localSignal);
    video.pause();
    if (logo) {
      logoImage = new Image();
      if (typeof logoImage.decode !== 'function') throw fail('UNSUPPORTED_API', 'This browser does not provide the image decoder required for logo export.');
      logoUrl = URL.createObjectURL(logo);
      logoImage.src = logoUrl;
      try { await guarded(logoImage.decode(), localSignal); }
      catch (cause) { checkAbort(localSignal); throw fail('INVALID_INPUT', 'The browser could not read this logo image. Try a PNG or JPEG.', cause); }
      if (!logoImage.naturalWidth || !logoImage.naturalHeight) throw fail('INVALID_INPUT', 'The logo image has no dimensions.');
    }
    if (background && chroma.enabled) {
      backgroundImage=new Image();backgroundUrl=URL.createObjectURL(background);backgroundImage.src=backgroundUrl;
      try { await guarded(backgroundImage.decode(),localSignal); }
      catch(cause) { checkAbort(localSignal);throw fail('INVALID_INPUT','The background image could not be read. Try a PNG or JPEG.',cause); }
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
    const decodedAudio = await decodeSoundtrack(blob, audio, localSignal, { allowSilent: true });
    audioSource = audio.createBufferSource();
    audioSource.buffer = decodedAudio?.buffer || audio.createBuffer(1, 128, audio.sampleRate);
    audioSource.loop = !decodedAudio;
    audioSource.connect(audioDestination);
    // Keep a real zero-valued stream running for silent inputs. An unconnected
    // destination can emit no audio buffers and prevent WebKit's encoder flushing.
    if (music) {
      const decodedMusic = await decodeSoundtrack(music, audio, localSignal);
      musicSource = audio.createBufferSource();
      musicSource.buffer = decodedMusic.buffer;
      musicSource.loop = true;
      musicGain = audio.createGain();
      musicGain.gain.value = musicVolume;
      musicSource.connect(musicGain);
      musicGain.connect(audioDestination);
    }
    await seek(video, start, localSignal);
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
    if(maxEdge){
      const landscape=outputWidth>=outputHeight;
      const limitWidth=landscape?maxEdge:maxEdge*9/16,limitHeight=landscape?maxEdge*9/16:maxEdge;
      const scale=Math.min(1,limitWidth/outputWidth,limitHeight/outputHeight);
      if(scale<1){
        if(aspect==='original'){outputWidth=Math.max(2,Math.floor(outputWidth*scale/2)*2);outputHeight=Math.max(2,Math.floor(outputHeight*scale/2)*2);}
        else{const [a,b]=aspect.split(':').map(Number),factor=Math.floor(Math.min(outputWidth*scale/a,outputHeight*scale/b)/2)*2;outputWidth=a*factor;outputHeight=b*factor;}
      }
    }
    const cropX = (video.videoWidth - cropWidth) / 2;
    const cropY = (video.videoHeight - cropHeight) / 2;
    // Exact aspect and even encoder dimensions; original recordings retain their dimensions.
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: !!chroma.enabled });
    if (!context) throw fail('UNSUPPORTED_API', 'This browser cannot create a video drawing surface.');
    compositor=createCompositor({width:canvas.width,height:canvas.height,title,captionStyle,chroma,backgroundImage});
    const render = () => {
      context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
      compositor.draw(context,{time:video.currentTime,captions:cues});
      if (logoImage) {
        const scale = Math.min(canvas.width * 0.22 / logoImage.naturalWidth, canvas.height * 0.15 / logoImage.naturalHeight);
        const width = logoImage.naturalWidth * scale;
        const height = logoImage.naturalHeight * scale;
        const gap = Math.min(canvas.width, canvas.height) * 0.035;
        context.drawImage(logoImage, canvas.width - width - gap, gap, width, height);
      }
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
        cancelAnimationFrame(frame); if (decodedFrame) video?.cancelVideoFrameCallback(decodedFrame); clearInterval(watchdog);
        localSignal.removeEventListener('abort', abort);
        video.removeEventListener('ended', finish);
        video.removeEventListener('error', sourceError);
      };
      const finish = () => {
        if (finishRequested) return;
        finishRequested = true;
        clean(); video.pause();
        try { audioSource?.stop(); } catch {}
        try { musicSource?.stop(); } catch {}
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
      cleanupCallbacks.push(clean);
      watchdog = setInterval(() => {
        if (performance.now() - lastMovement > 10000 || audio.state !== 'running') {
          controller.abort(fail('INTERRUPTED', 'Playback or audio processing was interrupted. Keep the screen awake and try again.'));
        }
      }, 500);
      try {
        checkAbort(localSignal);
        // Start from the first decoded post-seek frame, not play() resolution:
        // WebKit may resolve that promise late, or expose a stale frame at seeked.
        decodedFrame = video.requestVideoFrameCallback(() => {
          if (finishRequested || localSignal.aborted) return;
          try {
            if (video.currentTime - start > 0.15) throw fail('TIMING_UNRELIABLE', 'Video playback started too late to preserve the trim boundary. Try export again.');
            render();
            recorder.start(1000);
            const audioStart = audio.currentTime;
            if (decodedAudio) {
              const audibleStart = Math.max(start, decodedAudio.leadIn);
              const audibleEnd = Math.min(clipEnd, decodedAudio.leadIn + decodedAudio.buffer.duration);
              if (audibleEnd > audibleStart) audioSource.start(audioStart + audibleStart - start, audibleStart - decodedAudio.leadIn, audibleEnd - audibleStart);
            } else audioSource.start(audioStart, 0);
            musicSource?.start(audioStart, 0);
            lastMovement = performance.now();
            frame = requestAnimationFrame(tick);
          } catch (error) { clean(); reject(error); }
        });
        Promise.resolve(video.play()).catch(error => {
          if (finishRequested || localSignal.aborted) return;
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
    if (error?.name === 'VisualEffectsError') throw fail(error.code,error.message,error);
    if (error?.name === 'NotAllowedError') throw fail('USER_GESTURE_REQUIRED', 'Tap export again to allow local playback and audio processing.', error);
    if (error?.name === 'NotSupportedError') throw fail('UNSUPPORTED_FORMAT', 'This browser cannot decode or encode this video format.', error);
    throw fail('PROCESSING_FAILED', 'Local video processing failed. The original video is unchanged.', error);
  } finally {
    cleanupCallbacks.forEach(fn => fn());
    cancelAnimationFrame(frame); if (decodedFrame) video?.cancelVideoFrameCallback(decodedFrame); clearInterval(watchdog);
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch {} }
    if (recorder) { recorder.ondataavailable = null; recorder.onerror = null; recorder.onstop = null; }
    video?.pause();
    outputStream?.getTracks().forEach(track => track.stop());
    canvasStream?.getTracks().forEach(track => track.stop());
    audioDestination?.stream.getTracks().forEach(track => track.stop());
    try { audioSource?.stop(); } catch {}
    try { musicSource?.stop(); } catch {}
    try { audioSource?.disconnect(); } catch {}
    try { musicSource?.disconnect(); } catch {}
    try { musicGain?.disconnect(); } catch {}
    try { audioDestination?.disconnect(); } catch {}
    if (audio && audio.state !== 'closed') { try { await audio.close(); } catch {} }
    if (video) { video.removeAttribute('src'); video.load(); video.remove(); }
    compositor?.dispose();
    if (backgroundImage) backgroundImage.removeAttribute('src');
    if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
    if (logoImage) logoImage.removeAttribute('src');
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    if (logoUrl) URL.revokeObjectURL(logoUrl);
    signal?.removeEventListener('abort', forwardAbort);
    document.removeEventListener('visibilitychange', onVisibility);
  }
}
