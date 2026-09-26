// Keep the share payload limited to the video. The operating system, not the
// web app, chooses the available destinations and whether Save Video is shown.
const VIDEO_FORMATS = new Map([
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
  ['video/quicktime', 'mov'],
  ['video/ogg', 'ogv'],
  ['video/mpeg', 'mpeg'],
]);

function unsupported(message) {
  const error = new Error(message);
  error.name = 'NotSupportedError';
  return error;
}

/** Wrap the original bytes in a shareable File; this does not transcode video. */
export function prepareVideoFile(blob, title = 'My video') {
  if (!(blob instanceof Blob) || !blob.size) {
    throw new TypeError('This recording has no video data to share.');
  }
  // MediaRecorder MIME strings may include codec parameters. Use the canonical
  // container MIME and matching extension for the exported File.
  const type = blob.type.split(';', 1)[0].trim().toLowerCase();
  const extension = VIDEO_FORMATS.get(type);
  if (!extension) throw unsupported('This recording has an unrecognised video format.');
  const base = String(title ?? '').normalize('NFC')
    .replace(/\.(?:mp4|webm|mov|ogv|mpeg|mpg)$/i, '')
    .replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 100).trim() || 'My video';
  return new File([blob], `${base}.${extension}`, { type });
}

/** Missing canShare is inconclusive: allow share() itself to decide. */
export function canShareVideo(file, navigatorRef = globalThis.navigator) {
  if (typeof navigatorRef?.share !== 'function') {
    return { supported: false, error: unsupported('This browser cannot open the video share sheet.') };
  }
  if (typeof navigatorRef.canShare === 'function') {
    try {
      if (!navigatorRef.canShare({ files: [file] })) {
        return { supported: false, error: unsupported('This browser cannot share this video file.') };
      }
    } catch (error) {
      return { supported: false, error };
    }
  }
  return { supported: true };
}

/** Call directly in a click handler; no asynchronous work precedes share(). */
export function shareVideoFile(file, navigatorRef = globalThis.navigator) {
  const availability = canShareVideo(file, navigatorRef);
  if (!availability.supported) throw availability.error;
  return navigatorRef.share({ files: [file] });
}
