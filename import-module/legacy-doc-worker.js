/* Local-only worker. Does not execute macros, load links, or render document HTML. */
importScripts('./vendor/docToText.js');
self.onmessage = ({ data }) => {
  try {
    const text = self.docToText(data);
    if (typeof text !== 'string') throw Object.assign(new Error(), { code: 'INVALID_DOC' });
    if (text.length > 500000) throw Object.assign(new Error(), { code: 'TEXT_TOO_LONG' });
    self.postMessage({ text });
  } catch (error) {
    self.postMessage({ error: error?.code || 'INVALID_DOC' });
  }
};
