/** Local Word 97–2003 body-text extraction in a disposable worker. */
export function readLegacyDoc(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 512) return Promise.reject(docError('INVALID_DOC'));
  if (bytes.byteLength > 15 * 1024 * 1024) return Promise.reject(docError('FILE_TOO_LARGE'));
  if (typeof Worker !== 'function') return Promise.reject(docError('DOC_ENGINE_UNAVAILABLE'));
  return new Promise((resolve, reject) => {
    let worker, timer;
    const finish = (error, text) => {
      clearTimeout(timer);
      worker?.terminate();
      error ? reject(error) : resolve(text);
    };
    try {
      worker = new Worker(new URL('./legacy-doc-worker.js', import.meta.url));
      timer = setTimeout(() => finish(docError('DOC_TIMEOUT')), 8000);
      worker.onerror = () => finish(docError('DOC_ENGINE_UNAVAILABLE'));
      worker.onmessageerror = () => finish(docError('INVALID_DOC'));
      worker.onmessage = ({ data }) => {
        if (data?.error) { finish(docError(data.error)); return; }
        if (typeof data?.text !== 'string') { finish(docError('INVALID_DOC')); return; }
        if (data.text.length > 500000) { finish(docError('TEXT_TOO_LONG')); return; }
        finish(null, data.text);
      };
      const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer : bytes.slice().buffer;
      worker.postMessage(buffer, [buffer]);
    } catch { finish(docError('DOC_ENGINE_UNAVAILABLE')); }
  });
}

const messages = {
  INVALID_DOC: 'This DOC file is damaged or uses an unsupported format. Open it in Word or Pages and save an unprotected DOCX copy.',
  OLD_DOC: 'This file uses the older Word 6/95 format. Open it in Word or Pages and save it as DOCX.',
  PASSWORD_REQUIRED: 'This DOC file is password-protected. Save an unlocked DOCX copy and import it again.',
  FILE_TOO_LARGE: 'This file is larger than 15 MB. Export only the script text, or split it into smaller files.',
  TEXT_TOO_LONG: 'This script is too long to import. Split it into scripts of fewer than 500,000 characters.',
  DOC_TIMEOUT: 'This DOC file is too complex to import here. Save its script as DOCX or TXT and try again.',
  DOC_ENGINE_UNAVAILABLE: 'The DOC importer could not load. Reopen the app while online once, then try again. You can also paste the script or save it as DOCX.',
};
function docError(code) {
  if (!Object.hasOwn(messages, code)) code = 'INVALID_DOC';
  return Object.assign(new Error(messages[code]), { code });
}
