/**
 * Experimental browser speech-to-script following. No microphone-level proxy.
 * Browser recognition may use a provider's servers; callers must disclose that
 * before start(). Feature detection does not guarantee recognition availability.
 *
 * onPosition receives the LAST matched whitespace-delimited script word, 0-based.
 * start(n) / seek(n) treat n as the NEXT word to read. stop() is synchronous and
 * invalidates all pending callbacks and retries. It also releases the recognizer.
 */

const FILLERS = new Set(['um', 'uh', 'umm', 'uhh', 'erm', 'hmm', 'hm']);
const MAX_RETRIES = 3;
const RETRY_DELAYS = [300, 800, 1600];
const START_TIMEOUT = 12000;
const MAX_TRANSCRIPT_CHUNK = 28;

function normalize(word) {
  return word.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function scriptWords(text) {
  return (String(text || '').match(/\S+/gu) || []).map((raw, wordIndex) => ({
    value: normalize(raw), wordIndex,
  })).filter(word => word.value);
}

function spokenWords(text) {
  return (String(text || '').match(/\S+/gu) || []).map(normalize)
    .filter(word => word && !FILLERS.has(word));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? Math.floor(value) : minimum));
}

/**
 * Pure, conservative local transcript alignment. Returns null without sufficient
 * evidence. The search covers at most 36 forward script words, with 4 words of
 * overlap by default. Spoken insertions (including restarts) and occasional
 * skipped script words are allowed. Exact normalized matches drive all movement.
 * `matches` refers to normalized non-filler transcript tokens, not raw words.
 * Long utterances should be supplied in chunks; this helper considers 28 tokens.
 */
export function alignTranscript(script, transcript, startWordIndex = 0, options = {}) {
  const words = Array.isArray(script) ? script : scriptWords(script);
  const speech = (Array.isArray(transcript) ? transcript : spokenWords(transcript))
    .slice(0, MAX_TRANSCRIPT_CHUNK);
  if (!words.length || !speech.length) return null;
  const anchor = Math.max(0, Math.floor(Number(startWordIndex) || 0));
  const lookBack = clamp(options.lookBack ?? 4, 0, 8);
  const lookAhead = clamp(options.lookAhead ?? 36, 4, 48);
  const maxStartAhead = clamp(options.maxStartAhead ?? 8, 0, 12);
  const lower = words.findIndex(word => word.wordIndex >= Math.max(0, anchor - lookBack));
  if (lower === -1) return null;
  const candidates = words.slice(lower).filter(word => word.wordIndex < anchor + lookAhead);
  let best = null;

  for (let start = 0; start < candidates.length; start += 1) {
    const firstIndex = candidates[start].wordIndex;
    if (firstIndex > anchor + maxStartAhead) break;
    // A lone word can confirm the expected word, but must never jump ahead.
    if (speech.length === 1 && firstIndex !== anchor) continue;
    const target = candidates.slice(start);
    const rows = speech.length + 1;
    const columns = target.length + 1;
    const scores = Array.from({ length: rows }, () => new Float64Array(columns).fill(-Infinity));
    const steps = Array.from({ length: rows }, () => new Uint8Array(columns));
    scores[0][0] = 0;
    for (let i = 1; i < rows; i += 1) {
      scores[i][0] = -1.2 * i;
      steps[i][0] = 2;
      for (let j = 1; j < columns; j += 1) {
        const exact = speech[i - 1] === target[j - 1].value;
        const diagonal = scores[i - 1][j - 1] + (exact ? 3 : -2.6);
        const insertion = scores[i - 1][j] - 1.2;
        const deletion = scores[i][j - 1] - 1.8;
        scores[i][j] = Math.max(diagonal, insertion, deletion);
        steps[i][j] = scores[i][j] === diagonal ? 1 : scores[i][j] === insertion ? 2 : 3;
      }
    }
    for (let end = 1; end < columns; end += 1) {
      if (scores[speech.length][end] <= 0) continue;
      let i = speech.length;
      let j = end;
      const matches = [];
      while (i > 0 || j > 0) {
        const step = steps[i][j];
        if (step === 1) {
          if (speech[i - 1] === target[j - 1].value) {
            matches.push({ transcriptIndex: i - 1, wordIndex: target[j - 1].wordIndex });
          }
          i -= 1; j -= 1;
        } else if (step === 2) i -= 1;
        else if (step === 3) j -= 1;
        else break;
      }
      matches.reverse();
      if (!matches.length || matches[0].wordIndex !== firstIndex) continue;
      const last = matches[matches.length - 1];
      if (last.transcriptIndex < speech.length - 2) continue;
      const matchedSpeech = new Set(matches.map(match => match.transcriptIndex));
      // Repeated words/short phrases are disfluencies, not evidence of progress.
      // Discount only nearby repetitions of an actually matched spoken token.
      let novelUnmatched = 0;
      for (let index = 0; index < speech.length; index += 1) {
        if (matchedSpeech.has(index)) continue;
        const repeated = matches.some(match => Math.abs(match.transcriptIndex - index) <= 4
          && speech[match.transcriptIndex] === speech[index]);
        if (!repeated) novelUnmatched += 1;
      }
      const speechCoverage = matches.length / (matches.length + novelUnmatched);
      const scriptCoverage = matches.length / (last.wordIndex - firstIndex + 1);
      const forwardGap = Math.max(0, firstIndex - anchor);
      if (matches.length < Math.min(2, speech.length) || speechCoverage < 0.67 || scriptCoverage < 0.6) continue;
      if (forwardGap > 2 && (matches.length < 3 || speechCoverage < 0.8 || scriptCoverage < 0.8)) continue;
      const quality = scores[speech.length][end] - forwardGap * 0.8 - Math.max(0, anchor - firstIndex) * 0.25;
      if (!best || quality > best.quality) {
        best = {
          wordIndex: last.wordIndex,
          nextWordIndex: last.wordIndex + 1,
          matchedWords: matches.length,
          confidence: Math.min(speechCoverage, scriptCoverage),
          matches,
          quality,
        };
      }
    }
  }
  if (!best) return null;
  const { quality, ...alignment } = best;
  return alignment;
}

function recognitionConstructor() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
}

function makeError(code, message, cause) {
  const error = new Error(message);
  error.name = 'VoiceFollowError';
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

const ERROR_MESSAGES = {
  'not-allowed': 'Microphone or speech recognition permission was denied. Allow access in browser settings, then start again.',
  'service-not-allowed': 'This browser cannot use its speech recognition service. Use manual or timed scrolling.',
  'audio-capture': 'The microphone is unavailable or in use. Check microphone access, then start again.',
  'language-not-supported': 'Speech recognition does not support the selected language on this device.',
  'bad-grammar': 'This browser rejected speech recognition. Use manual or timed scrolling.',
};

export class VoiceFollower {
  static supported() { return typeof recognitionConstructor() === 'function'; }

  constructor({ text = '', language = 'en-GB', onPosition = () => {}, onStatus = () => {}, onError = () => {} } = {}) {
    this.text = String(text);
    this.language = language || 'en-GB';
    this.onPosition = onPosition;
    this.onStatus = onStatus;
    this.onError = onError;
    this._words = scriptWords(this.text);
    this._wordCount = (this.text.match(/\S+/gu) || []).length;
    this._cursor = 0;
    this._lastPosition = -1;
    this._active = false;
    this._generation = 0;
    this._recognition = null;
    this._retryTimer = null;
    this._startTimer = null;
    this._retries = 0;
    this._resultStates = new Map();
    this._lastFinalResult = -1;
  }

  get running() { return this._active; }
  get position() { return this._lastPosition; }

  /** Call directly from a user gesture, after the UI's privacy disclosure. */
  start(startWordIndex = 0) {
    this._stop(false);
    this._cursor = clamp(startWordIndex, 0, this._wordCount);
    this._lastPosition = this._cursor - 1;
    this._retries = 0;
    if (!VoiceFollower.supported()) {
      this._fail(makeError('unsupported', 'Voice follow is unavailable in this browser. Use manual or timed scrolling.'));
      return false;
    }
    if (!this._words.some(word => word.wordIndex >= this._cursor)) {
      this.onStatus('No script remains to read.');
      return false;
    }
    this._active = true;
    this.onStatus('Starting voice follow…');
    this._open();
    return this._active;
  }

  stop() { this._stop(true); }

  seek(wordIndex) {
    const wasActive = this._active;
    this._stop(false);
    this._cursor = clamp(wordIndex, 0, this._wordCount);
    this._lastPosition = this._cursor - 1;
    this._retries = 0;
    if (!wasActive) return;
    if (!this._words.some(word => word.wordIndex >= this._cursor)) {
      this.onStatus('End of script.');
      return;
    }
    this._active = true;
    this.onStatus('Moving voice follow to the selected word…');
    const generation = this._generation;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (this._active && this._generation === generation) this._open();
    }, 160);
  }

  _detach() {
    clearTimeout(this._startTimer);
    this._startTimer = null;
    const recognition = this._recognition;
    this._recognition = null;
    if (!recognition) return;
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try { recognition.abort(); } catch { /* Already stopped or not started. */ }
  }

  _stop(report) {
    this._active = false;
    this._generation += 1;
    clearTimeout(this._retryTimer);
    this._retryTimer = null;
    this._detach();
    this._resultStates.clear();
    this._lastFinalResult = -1;
    if (report) this.onStatus('Voice follow stopped.');
  }

  _fail(error) {
    this._stop(false);
    this.onStatus(error.message);
    this.onError(error);
  }

  _retry(reason) {
    if (!this._active || this._retryTimer !== null) return;
    this._detach();
    if (this._retries >= MAX_RETRIES) {
      this._fail(makeError('retry-limit', `${reason} Voice follow paused after three retries. Tap start to try again, or use timed scrolling.`));
      return;
    }
    const delay = RETRY_DELAYS[this._retries];
    this._retries += 1;
    this.onStatus(`${reason} Reconnecting (${this._retries}/${MAX_RETRIES})…`);
    const generation = this._generation;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (this._active && this._generation === generation) this._open();
    }, delay);
  }

  _open() {
    if (!this._active) return;
    const generation = this._generation;
    let recognition;
    try {
      const Constructor = recognitionConstructor();
      recognition = new Constructor();
      recognition.lang = this.language;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
    } catch (cause) {
      this._fail(makeError('unavailable', 'Speech recognition could not start on this device. Use manual or timed scrolling.', cause));
      return;
    }
    this._recognition = recognition;
    this._resultStates.clear();
    this._lastFinalResult = -1;
    const current = () => this._active && this._generation === generation && this._recognition === recognition;
    recognition.onstart = () => {
      if (!current()) return;
      clearTimeout(this._startTimer);
      this._startTimer = null;
      this.onStatus('Listening. Read the script aloud.');
    };
    recognition.onresult = event => {
      if (current()) this._handleResults(event);
    };
    recognition.onerror = event => {
      if (!current()) return;
      const code = event.error || 'unknown';
      if (ERROR_MESSAGES[code]) this._fail(makeError(code, ERROR_MESSAGES[code]));
      else if (code === 'network') this._retry('The speech service could not connect.');
      else if (code === 'no-speech') this._retry('No speech was detected.');
      else if (code === 'aborted') this._retry('Speech recognition was interrupted.');
      else this._fail(makeError(code, 'Speech recognition is unavailable. Use manual or timed scrolling.'));
    };
    recognition.onend = () => {
      if (current()) this._retry('Speech recognition ended.');
    };
    this._startTimer = setTimeout(() => {
      if (current()) this._fail(makeError('start-timeout', 'Speech recognition did not start. Check microphone access and your connection, then try again.'));
    }, START_TIMEOUT);
    try { recognition.start(); }
    catch (cause) {
      const denied = cause?.name === 'NotAllowedError' || cause?.name === 'SecurityError';
      this._fail(makeError(denied ? 'not-allowed' : 'start-failed', denied
        ? ERROR_MESSAGES['not-allowed']
        : 'Speech recognition could not start. Tap start again, or use timed scrolling.', cause));
    }
  }

  _handleResults(event) {
    const generation = this._generation;
    for (let resultIndex = event.resultIndex || 0; resultIndex < event.results.length && this._active; resultIndex += 1) {
      if (resultIndex <= this._lastFinalResult) continue;
      const result = event.results[resultIndex];
      const speech = spokenWords(result?.[0]?.transcript || '');
      let state = this._resultStates.get(resultIndex);
      if (!state) {
        state = { anchor: this._cursor, speech: [], mapping: new Map() };
        this._resultStates.set(resultIndex, state);
      }
      let common = 0;
      while (common < speech.length && common < state.speech.length && speech[common] === state.speech[common]) common += 1;
      if (common !== speech.length || speech.length !== state.speech.length) {
        // Retain context around the changed suffix and its exact script anchor.
        let offset = Math.max(0, common - 4);
        while (offset > 0 && !state.mapping.has(offset)) offset -= 1;
        let anchor = state.mapping.get(offset) ?? state.anchor;
        for (const key of state.mapping.keys()) if (key >= common) state.mapping.delete(key);
        while (offset < speech.length) {
          const chunk = speech.slice(offset, offset + MAX_TRANSCRIPT_CHUNK);
          const alignment = alignTranscript(this._words, chunk, anchor);
          if (!alignment) break;
          for (const match of alignment.matches) {
            state.mapping.set(offset + match.transcriptIndex, match.wordIndex);
          }
          if (alignment.wordIndex > this._lastPosition) {
            this._lastPosition = alignment.wordIndex;
            this._cursor = alignment.nextWordIndex;
            this._retries = 0; // Real script progress resets consecutive-failure budget.
            this.onPosition(alignment.wordIndex);
            if (!this._active || this._generation !== generation) return; // Callback may stop or seek.
            if (this._cursor > this._words[this._words.length - 1].wordIndex) {
              this._stop(false);
              this.onStatus('End of script.');
              return;
            }
          }
          if (chunk.length < MAX_TRANSCRIPT_CHUNK) break;
          const consumed = alignment.matches[alignment.matches.length - 1].transcriptIndex + 1;
          if (consumed < MAX_TRANSCRIPT_CHUNK - 2) break;
          offset += consumed;
          anchor = alignment.nextWordIndex;
        }
        state.speech = speech;
      }
      if (result.isFinal) {
        this._lastFinalResult = resultIndex;
        this._resultStates.delete(resultIndex);
      }
    }
  }
}

export default VoiceFollower;
