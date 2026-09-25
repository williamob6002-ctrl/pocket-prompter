/**
 * Local level meter + sound/silence gate for an EXISTING microphone stream.
 * Does not recognise speech, request microphone access, connect to speakers,
 * record audio, upload audio, or stop the caller's shared media tracks.
 * Call prepare()/resume() directly in a user gesture, before awaiting anything.
 */

const FLOOR_DB = -100;
const SAMPLE_INTERVAL = 60;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const audioConstructor = () => globalThis.AudioContext || globalThis.webkitAudioContext;

function failure(code, message, cause) {
  const error = new Error(message);
  error.name = 'AudioMonitorError';
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

/** RMS dBFS of the browser-provided signal, not calibrated room loudness. */
export function measureSamples(samples) {
  let sum = 0;
  for (const sample of samples) sum += Number.isFinite(sample) ? sample * sample : 0;
  const rms = samples.length ? Math.sqrt(sum / samples.length) : 0;
  const db = rms > 0 ? clamp(20 * Math.log10(rms), FLOOR_DB, 0) : FLOOR_DB;
  return { db, level: clamp((db + 60) / 60, 0, 1) };
}

/** Opens on sound; a 6 dB lower release threshold and hold time prevent chatter. */
export class SilenceGate {
  constructor({ thresholdDb = -42, silenceMs = 1200 } = {}) {
    this.thresholdDb = clamp(Number.isFinite(Number(thresholdDb)) ? Number(thresholdDb) : -42, -80, -6);
    this.silenceMs = clamp(Number.isFinite(Number(silenceMs)) ? Number(silenceMs) : 1200, 0, 5000);
    this.reset();
  }

  reset() { this.speaking = false; this.lastSound = null; }

  update(db, now) {
    const threshold = this.speaking ? this.thresholdDb - 6 : this.thresholdDb;
    if (Number.isFinite(db) && db >= threshold) {
      this.speaking = true;
      this.lastSound = now;
    } else if (this.speaking && now - this.lastSound >= this.silenceMs) {
      this.speaking = false;
    }
    return this.speaking;
  }
}

export class AudioMonitor {
  static supported() { return typeof audioConstructor() === 'function'; }

  constructor({ onLevel = () => {}, onError = () => {} } = {}) {
    this.onLevel = onLevel;
    this.onError = onError;
    this._context = null;
    this._source = null;
    this._analyser = null;
    this._samples = null;
    this._bytes = null;
    this._frame = null;
    this._active = false;
    this._generation = 0;
    this._gate = new SilenceGate();
    this._tracks = [];
    this._ended = null;
    this._lastSample = null;
    this._suspendedAt = null;
    this._suspendedReported = false;
    this._resumePending = null;
  }

  get running() { return this._active; }

  /** Synchronous construction/resume invocation preserves the user activation. */
  prepare() {
    if (this._context && this._context.state !== 'closed') return this.resume();
    const Constructor = audioConstructor();
    if (typeof Constructor !== 'function') {
      this.onError(failure('unsupported', 'The microphone level meter is unavailable in this browser.'));
      return false;
    }
    try { this._context = new Constructor(); }
    catch (cause) {
      this.onError(failure('unavailable', 'The microphone level meter could not start.', cause));
      return false;
    }
    return this.resume();
  }

  /** Returns immediately; any asynchronous rejection goes to onError. */
  resume() {
    if (!this._context || this._context.state === 'closed') return this.prepare();
    const context = this._context;
    if (context.state === 'running') return true;
    if (this._resumePending === context) return true;
    try {
      // Deliberately call resume now, not after a promise/await boundary.
      const resumed = context.resume();
      this._resumePending = context;
      Promise.resolve(resumed).then(() => {
        if (this._resumePending === context) this._resumePending = null;
      }, cause => {
        if (this._resumePending === context) this._resumePending = null;
        if (this._context !== context) return;
        this.onError(failure('resume-denied', 'Tap the reading control to enable microphone monitoring.', cause));
      });
      return true;
    } catch (cause) {
      this.onError(failure('resume-denied', 'Tap the reading control to enable microphone monitoring.', cause));
      return false;
    }
  }

  /** Attaches to the caller's existing camera/microphone stream. */
  start(stream, { thresholdDb = -42, silenceMs = 1200 } = {}) {
    this._detach();
    const tracks = stream?.getAudioTracks?.().filter(track => track.readyState !== 'ended') || [];
    if (!tracks.length) {
      this.stop();
      this.onError(failure('no-audio', 'No live microphone track is available for monitoring.'));
      return false;
    }
    if (!this.prepare()) { this.stop(); return false; }
    const context = this._context;
    try {
      this._source = context.createMediaStreamSource(stream);
      this._analyser = context.createAnalyser();
      this._analyser.fftSize = 1024;
      this._analyser.smoothingTimeConstant = 0;
      this._samples = new Float32Array(this._analyser.fftSize);
      if (typeof this._analyser.getFloatTimeDomainData !== 'function') this._bytes = new Uint8Array(this._analyser.fftSize);
      // Analyser output is intentionally left unconnected. No speaker feedback.
      this._source.connect(this._analyser);
      this._gate = new SilenceGate({ thresholdDb, silenceMs });
      this._tracks = tracks;
      this._active = true;
      const generation = this._generation;
      this._ended = () => {
        if (!this._active || generation !== this._generation || this._tracks.some(track => track.readyState !== 'ended')) return;
        this.stop();
        this.onError(failure('audio-ended', 'Microphone monitoring stopped because the microphone was interrupted.'));
      };
      for (const track of tracks) track.addEventListener('ended', this._ended);
      this.onLevel({ db: FLOOR_DB, level: 0, speaking: false });
      if (!this._active || generation !== this._generation) return false;
      this._frame = requestAnimationFrame(now => this._tick(now, generation));
      return true;
    } catch (cause) {
      this.stop();
      this.onError(failure('start-failed', 'Microphone monitoring could not start. Recording can still be used without it.', cause));
      return false;
    }
  }

  _tick(now, generation) {
    this._frame = null;
    if (!this._active || generation !== this._generation) return;
    if (this._context.state === 'closed') {
      this.stop();
      this.onError(failure('audio-closed', 'Microphone monitoring stopped. Reopen the recording screen to enable it again.'));
      return;
    }
    if (this._lastSample === null || now - this._lastSample >= SAMPLE_INTERVAL) {
      this._lastSample = now;
      if (this._context.state !== 'running') {
        this._gate.reset();
        this.onLevel({ db: FLOOR_DB, level: 0, speaking: false });
        if (this._suspendedAt === null) this._suspendedAt = now;
        if (!this._suspendedReported && now - this._suspendedAt >= 1500) {
          this._suspendedReported = true;
          this.onError(failure('audio-suspended', 'Microphone monitoring is paused. Tap the reading control to resume it.'));
        }
      } else {
        this._suspendedAt = null;
        this._suspendedReported = false;
        try {
          if (this._bytes) {
            this._analyser.getByteTimeDomainData(this._bytes);
            for (let i = 0; i < this._bytes.length; i += 1) this._samples[i] = (this._bytes[i] - 128) / 128;
          } else this._analyser.getFloatTimeDomainData(this._samples);
          const measured = measureSamples(this._samples);
          this.onLevel({ ...measured, speaking: this._gate.update(measured.db, now) });
        } catch (cause) {
          this.stop();
          this.onError(failure('read-failed', 'The microphone level could not be read. Recording can continue without monitoring.', cause));
          return;
        }
      }
    }
    if (this._active && generation === this._generation) this._frame = requestAnimationFrame(time => this._tick(time, generation));
  }

  _detach() {
    this._active = false;
    this._generation += 1;
    if (this._frame !== null) cancelAnimationFrame(this._frame);
    this._frame = null;
    if (this._ended) for (const track of this._tracks) track.removeEventListener('ended', this._ended);
    this._tracks = [];
    this._ended = null;
    try { this._source?.disconnect(); } catch { /* Already disconnected. */ }
    try { this._analyser?.disconnect(); } catch { /* Already disconnected. */ }
    this._source = null;
    this._analyser = null;
    this._samples = null;
    this._bytes = null;
    this._lastSample = null;
    this._suspendedAt = null;
    this._suspendedReported = false;
    this._gate.reset();
  }

  /** Releases only this monitor's nodes/context. Never stops shared tracks. */
  stop() {
    this._detach();
    const context = this._context;
    this._context = null;
    this._resumePending = null;
    if (context && context.state !== 'closed') {
      try { Promise.resolve(context.close()).catch(() => {}); } catch { /* Already closed. */ }
    }
  }
}

export default AudioMonitor;
