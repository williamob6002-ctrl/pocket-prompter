/** Local-only script import. Render returned strings via textContent/value, never innerHTML. */
import { unzipSync } from './vendor/fflate.mjs';

export const SCRIPT_FILE_ACCEPT = '.txt,.md,.markdown,.doc,.docx,.pdf,.rtf,.gdoc,application/msword,text/plain,text/markdown,application/pdf,application/rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const IMPORT_LIMITS = Object.freeze({ maxBytes: 15 * 1024 * 1024, maxCharacters: 500_000, maxPdfPages: 200, maxDocxXmlBytes: 5 * 1024 * 1024 });

export class ScriptImportError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ScriptImportError';
    this.code = code;
  }
}
const fail = (code, message, cause) => new ScriptImportError(code, message, cause);
const wordNamespaces = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);

function normalizeText(value) {
  return value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

function textResult(value, extension) {
  const text = normalizeText(value);
  if (!text) {
    if (extension === 'pdf') throw fail('NO_TEXT', 'This PDF has no readable text. It may be a scan or photo. Copy the script from the original document, or save it as a text-based PDF.');
    throw fail('NO_TEXT', 'This file has no script text. Add some text and save it again.');
  }
  if (text.length > IMPORT_LIMITS.maxCharacters) throw fail('TEXT_TOO_LONG', 'This script is too long to import. Split it into scripts of fewer than 500,000 characters.');
  return text;
}

function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
  if (bytes.includes(0)) throw fail('INVALID_TEXT', 'This is not a plain text file. Save it as UTF-8 text, DOCX, or PDF and try again.');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}

function readDocx(bytes) {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw fail('INVALID_DOCX', 'This DOCX file is damaged or password-protected. Open it in Word or Pages and save an unprotected DOCX copy.');
  let tooLarge = false;
  const files = unzipSync(bytes, { filter: (entry) => {
    if (entry.name !== 'word/document.xml') return false;
    if (entry.originalSize > IMPORT_LIMITS.maxDocxXmlBytes) { tooLarge = true; return false; }
    return true;
  } });
  if (tooLarge) throw fail('DOCX_TOO_LARGE', 'This Word document is too complex to import. Copy its script into a new document and try again.');
  const xmlBytes = files['word/document.xml'];
  if (!xmlBytes) throw fail('INVALID_DOCX', 'This file is not a readable DOCX document. Open it in Word or Pages and save a new DOCX copy.');
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(xmlBytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw fail('INVALID_DOCX', 'This Word document uses an unsupported format. Save a new DOCX copy from Word or Pages.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') || !wordNamespaces.has(doc.documentElement.namespaceURI) || doc.documentElement.localName !== 'document') throw fail('INVALID_DOCX', 'This Word document is damaged. Open it in Word or Pages and save a new DOCX copy.');
  const body = [...doc.documentElement.children].find(node => node.localName === 'body' && wordNamespaces.has(node.namespaceURI));
  if (!body) throw fail('INVALID_DOCX', 'This Word document has no readable document body.');
  const output = [];
  function visit(node, depth = 0) {
    if (depth > 128) throw fail('INVALID_DOCX', 'This Word document is too complex to import. Save its script as plain text.');
    const isWord = wordNamespaces.has(node.namespaceURI);
    if (isWord && ['del', 'moveFrom', 'instrText', 'pPr', 'rPr', 'sdtPr'].includes(node.localName)) return;
    if (isWord && node.localName === 't') { output.push(node.textContent); return; }
    if (isWord && node.localName === 'tab') { output.push('\t'); return; }
    if (isWord && ['br', 'cr'].includes(node.localName)) { output.push('\n'); return; }
    for (const child of node.children) visit(child, depth + 1);
    if (isWord && node.localName === 'p') output.push('\n\n');
  }
  visit(body);
  return output.join('');
}

let pdfLibrary;
async function readPdf(bytes) {
  if (!new TextDecoder('ascii').decode(bytes.subarray(0, 1024)).includes('%PDF-')) throw fail('INVALID_PDF', 'This file is not a readable PDF. Open the original and export a new PDF copy.');
  let pdfjs;
  try {
    pdfLibrary ??= import('./vendor/pdfjs/pdf.min.mjs').catch(error => { pdfLibrary = undefined; throw error; });
    pdfjs = await pdfLibrary;
  } catch (error) {
    throw fail('PDF_ENGINE_UNAVAILABLE', 'The PDF importer could not load. Reopen the app while online once, then try again. You can also paste the script or import TXT/DOCX.', error);
  }
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  let loadingTask;
  try {
    loadingTask = pdfjs.getDocument({
      data: bytes,
      cMapUrl: new URL('./vendor/pdfjs/cmaps/', import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', import.meta.url).href,
      useWorkerFetch: true,
      useWasm: false,
      useSystemFonts: true,
      disableFontFace: true,
      enableXfa: false,
      stopAtErrors: true,
      verbosity: 0,
    });
    const pdf = await loadingTask.promise;
    if (pdf.numPages > IMPORT_LIMITS.maxPdfPages) throw fail('TOO_MANY_PAGES', 'This PDF has more than 200 pages. Export only the script pages and try again.');
    const pages = [];
    let total = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const parts = [];
      let previous;
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        if (previous && parts.length && !parts[parts.length - 1].endsWith('\n')) {
          const sameLine = Math.abs(item.transform[5] - previous.transform[5]) <= Math.max(2, item.height * 0.3);
          if (!sameLine) parts.push('\n');
          else if (!/\s$/.test(parts[parts.length - 1]) && !/^\s/.test(item.str) && item.str) {
            const gap = item.transform[4] - (previous.transform[4] + previous.width);
            if (gap > Math.max(0.5, item.height * 0.08)) parts.push(' ');
          }
        }
        parts.push(item.str);
        if (item.hasEOL) parts.push('\n');
        previous = item;
      }
      const text = parts.join('');
      total += text.length;
      if (total > IMPORT_LIMITS.maxCharacters) throw fail('TEXT_TOO_LONG', 'This script is too long to import. Split the PDF into smaller documents.');
      pages.push(text);
      page.cleanup();
    }
    return pages.join('\n\n');
  } catch (error) {
    if (error instanceof ScriptImportError) throw error;
    if (error?.name === 'PasswordException') throw fail('PASSWORD_REQUIRED', 'This PDF is password-protected. Save an unlocked copy and import it again.', error);
    if (/worker|fetch|dynamically imported/i.test(error?.message || '')) throw fail('PDF_ENGINE_UNAVAILABLE', 'The PDF importer could not load. Reopen the app while online once, then try again. You can also paste the script or import TXT/DOCX.', error);
    throw fail('INVALID_PDF', 'This PDF could not be read. It may be damaged. Open the original and export a new PDF copy.', error);
  } finally {
    if (loadingTask) await loadingTask.destroy().catch(() => {});
  }
}

const rtfDestinations = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'objdata', 'listtable', 'listoverridetable', 'generator', 'datastore', 'themedata', 'colorschememapping', 'header', 'headerl', 'headerr', 'footer', 'footerl', 'footerr', 'fldinst', 'filetbl', 'revtbl', 'rsidtbl', 'xmlnstbl', 'nonshppict']);

/** Basic RTF text extraction, including Unicode, escaped bytes, and skipped objects. */
function readRtf(bytes) {
  const chunks = [];
  for (let start = 0; start < bytes.length; start += 8192) chunks.push(String.fromCharCode(...bytes.subarray(start, start + 8192)));
  const source = chunks.join('');
  if (!/^\{\\rtf\d/.test(source)) throw fail('INVALID_RTF', 'This is not a readable RTF file. Save a new RTF or TXT copy and try again.');
  let state = { skip: false, uc: 1, codepage: 'windows-1252' };
  const stack = [], output = [], pending = [];
  let fallback = 0, outputLength = 0;
  const append = value => {
    outputLength += value.length;
    if (outputLength > IMPORT_LIMITS.maxCharacters) throw fail('TEXT_TOO_LONG', 'This script is too long to import. Split it into smaller RTF documents.');
    output.push(value);
  };
  const flush = () => {
    if (pending.length && !state.skip) {
      let decoded;
      try { decoded = new TextDecoder(state.codepage).decode(new Uint8Array(pending)); }
      catch { throw fail('UNSUPPORTED_RTF_ENCODING', 'This RTF uses an unsupported text encoding. Save it as UTF-8 TXT or DOCX.'); }
      append(decoded);
    }
    pending.length = 0;
  };
  const byte = value => { if (fallback) { fallback--; return; } if (!state.skip) { pending.push(value); if (pending.length >= 8192 && state.codepage !== 'utf-8') flush(); } };
  const text = value => { flush(); if (fallback) { fallback--; return; } if (!state.skip) append(value); };
  for (let i = 0; i < source.length;) {
    const ch = source[i++];
    if (ch === '{') {
      flush();
      if (stack.length >= 256) throw fail('INVALID_RTF', 'This RTF is too complex to import. Save its script as TXT.');
      stack.push(state); state = { ...state }; continue;
    }
    if (ch === '}') { flush(); if (!stack.length) throw fail('INVALID_RTF', 'This RTF file is damaged. Save a new copy and try again.'); state = stack.pop(); continue; }
    if (ch === '\r' || ch === '\n') continue;
    if (ch !== '\\') { byte(ch.charCodeAt(0)); continue; }
    const next = source[i++];
    if (['\\', '{', '}'].includes(next)) { byte(next.charCodeAt(0)); continue; }
    if (next === "'") {
      const hex = source.slice(i, i + 2);
      if (!/^[0-9a-f]{2}$/i.test(hex)) throw fail('INVALID_RTF', 'This RTF file contains damaged text. Save a new copy and try again.');
      byte(parseInt(hex, 16)); i += 2; continue;
    }
    flush();
    if (next === '*') { state.skip = true; continue; }
    if (next === '~') { text('\u00a0'); continue; }
    if (next === '_') { text('\u2011'); continue; }
    if (next === '-') continue;
    if (!/[A-Za-z]/.test(next || '')) continue;
    let word = next;
    while (/[A-Za-z]/.test(source[i] || '')) word += source[i++];
    const start = i;
    if (source[i] === '-') i++;
    while (/\d/.test(source[i] || '')) i++;
    const parameter = source.slice(start, i);
    const number = parameter && parameter !== '-' ? Number(parameter) : undefined;
    if (source[i] === ' ') i++;
    if (word === 'bin') { if (!Number.isSafeInteger(number) || number < 0 || i + number > source.length) throw fail('INVALID_RTF', 'This RTF file contains damaged data.'); i += number; continue; }
    if (rtfDestinations.has(word)) { state.skip = true; continue; }
    if (word === 'uc' && number >= 0 && number <= 16) { state.uc = number; continue; }
    if (word === 'ansicpg' && number) { state.codepage = number === 65001 ? 'utf-8' : `windows-${number}`; continue; }
    if (word === 'u' && Number.isInteger(number)) { if (!state.skip) append(String.fromCharCode(number < 0 ? number + 65536 : number)); fallback = state.uc; continue; }
    if (state.skip) continue;
    if (['par', 'line', 'row'].includes(word)) text('\n');
    else if (['tab', 'cell'].includes(word)) text('\t');
    else if (word === 'emdash') text('\u2014');
    else if (word === 'endash') text('\u2013');
    else if (word === 'bullet') text('\u2022');
    else if (word === 'lquote' || word === 'rquote') text(word === 'lquote' ? '\u2018' : '\u2019');
    else if (word === 'ldblquote' || word === 'rdblquote') text(word === 'ldblquote' ? '\u201c' : '\u201d');
  }
  flush();
  if (stack.length) throw fail('INVALID_RTF', 'This RTF file is incomplete. Save a new copy and try again.');
  return output.join('');
}

/** @param {File} file @returns {Promise<{title:string,text:string}>} */
export async function importScriptFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || typeof file.name !== 'string' || !Number.isFinite(file.size)) throw fail('NO_FILE', 'Choose a script file to import.');
  if (file.size === 0) throw fail('EMPTY_FILE', 'This file is empty. Choose a file that contains your script.');
  if (file.size > IMPORT_LIMITS.maxBytes) throw fail('FILE_TOO_LARGE', 'This file is larger than 15 MB. Export only the script text, or split it into smaller files.');
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'gdoc') throw fail('GOOGLE_DOC_SHORTCUT', 'This is a Google Docs shortcut, not the script itself. Open the document in Google Docs, export a Word (.docx) or TXT copy, then import that file. You can also copy and paste the script.');
  if (!['txt', 'md', 'markdown', 'doc', 'docx', 'pdf', 'rtf'].includes(extension)) throw fail('UNSUPPORTED_TYPE', 'Choose a TXT, Markdown, DOC, DOCX, PDF, or RTF file. For Pages documents, export a DOCX copy first.');
  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); }
  catch (error) { throw fail('READ_FAILED', 'This file could not be opened. If it is in iCloud Drive, download it in Files first, then try again.', error); }
  try {
    let raw;
    if (extension === 'doc') {
      // Word also writes RTF documents carrying the .doc extension.
      if (new TextDecoder('ascii').decode(bytes.subarray(0, 12)).startsWith('{\\rtf')) raw = readRtf(bytes);
      else {
        try { const { readLegacyDoc } = await import('./legacy-doc.mjs'); raw = await readLegacyDoc(bytes); }
        catch (error) { throw fail(error?.code || 'DOC_ENGINE_UNAVAILABLE', error?.code ? error.message : 'The DOC importer could not load. Reopen the app online once, or save the script as DOCX.', error); }
      }
    }
    else if (extension === 'docx') raw = readDocx(bytes);
    else if (extension === 'pdf') raw = await readPdf(bytes);
    else if (extension === 'rtf') raw = readRtf(bytes);
    else raw = decodeText(bytes);
    return {
      title: file.name.replace(/\.[^.]+$/, '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160) || 'Imported script',
      text: textResult(raw, extension),
    };
  } catch (error) {
    if (error instanceof ScriptImportError) throw error;
    if (extension === 'docx') throw fail('INVALID_DOCX', 'This Word document could not be read. It may be damaged or password-protected. Save a new, unprotected DOCX copy and try again.', error);
    throw fail('READ_FAILED', 'This file could not be read. Save a new TXT or DOCX copy and try again.', error);
  }
}

/** Creates a local export for Web Share or an object-URL download; never uploads. */
export function exportScriptFile(script, format = 'txt') {
  if (!script || typeof script.text !== 'string') throw fail('NO_SCRIPT', 'Choose a script to export.');
  if (!['txt', 'md'].includes(format)) throw fail('UNSUPPORTED_EXPORT', 'Choose TXT or Markdown for export.');
  const title = String(script.title || 'Script').trim();
  const stem = title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').replace(/^\.+|\.+$/g, '').slice(0, 100).trim() || 'Script';
  const fileName = `${stem}.${format}`;
  const mimeType = format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
  const blob = new Blob([script.text], { type: mimeType });
  return { fileName, mimeType, blob, file: new File([blob], fileName, { type: mimeType }) };
}
