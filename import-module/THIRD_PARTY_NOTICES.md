# Bundled open-source libraries

- fflate 0.8.3, MIT. https://github.com/101arrowz/fflate — see vendor/LICENSE-fflate.txt.
- Mozilla PDF.js 6.3.289, Apache-2.0. https://github.com/mozilla/pdf.js — see vendor/pdfjs/LICENSE.txt.
- PDF.js CMaps: see vendor/pdfjs/cmaps/LICENSE.
- PDF.js standard fonts: see the LICENSE files in vendor/pdfjs/standard_fonts/.

These files are bundled locally. There are no runtime CDN dependencies. PDF.js uses its legacy build with compatibility polyfills. The optional PDF JavaScript sandbox is not included or enabled.

- JSDoc plain-text DOC parser, 0BSD, pinned at `821695a884e0c0bb8592a635d9524bb3e116cd67`: https://github.com/Alpaq92/JSDoc — see vendor/docToText.LICENSE. Locally hardened for bounded plain-body extraction in an isolated worker; no document macros or links execute. The upstream source SHA256 was `1480cd409c36b0e8890509516ff6909dffd73a825211e821e1e09b880fc635db`.
