/** Pure local canvas composition. Assets must already be decoded by the caller. */

const POSITIONS = ['top', 'center', 'bottom'];
const SIZES = { small: 0.8, medium: 1, large: 1.3 };
const FONT = 'system-ui, -apple-system, Arial, sans-serif';
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function fail(code, message, cause) {
  const error = new Error(message);
  error.name = 'VisualEffectsError'; error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function hex(value, fallback) {
  const color = value ?? fallback;
  if (typeof color !== 'string' || !/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(color)) {
    throw fail('INVALID_EFFECTS', 'Choose a valid text or background colour.');
  }
  return color.length === 4 ? `#${[...color.slice(1)].map(c => c + c).join('')}` : color;
}

function number(value, fallback, min, max, label) {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < min || result > max) {
    throw fail('INVALID_EFFECTS', `${label} must be between ${min} and ${max}.`);
  }
  return result;
}

function style(options = {}, defaults = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw fail('INVALID_EFFECTS', 'Use valid text style settings.');
  const result = {
    size: options.size ?? 'medium',
    position: options.position ?? defaults.position ?? 'bottom',
    color: hex(options.color, '#ffffff'),
    background: options.background ?? true,
    backgroundColor: hex(options.backgroundColor, '#000000'),
    backgroundOpacity: number(options.backgroundOpacity, defaults.opacity ?? 0.78, 0, 1, 'Background opacity'),
  };
  if (!Object.hasOwn(SIZES, result.size) || !POSITIONS.includes(result.position) || typeof result.background !== 'boolean') {
    throw fail('INVALID_EFFECTS', 'Choose a supported text size, position and background style.');
  }
  return result;
}

function chromaOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw fail('INVALID_EFFECTS', 'Use valid chroma key settings.');
  const result = {
    enabled: options.enabled ?? false,
    key: options.key ?? 'green',
    threshold: number(options.threshold, 0.2, 0, 0.9, 'Chroma threshold'),
    softness: number(options.softness, 0.12, 0.001, 0.5, 'Edge softness'),
    spill: number(options.spill, 0.5, 0, 1, 'Spill reduction'),
    backgroundColor: hex(options.backgroundColor, '#163b83'),
  };
  if (typeof result.enabled !== 'boolean' || !['green', 'blue'].includes(result.key)) {
    throw fail('INVALID_EFFECTS', 'Choose green or blue for chroma key.');
  }
  return result;
}

/**
 * Mutates foreground RGBA bytes; background must be an equally sized opaque RGBA
 * buffer. Chromaticity, rather than brightness alone, permits shaded key colours.
 * Unmatched opaque pixels remain byte-for-byte unchanged. This is chroma key,
 * not subject segmentation: matching clothing/objects are replaced too.
 */
export function applyChromaToPixels(foreground, background, options = {}) {
  if (!foreground || !background || foreground.length !== background.length || foreground.length % 4) {
    throw fail('INVALID_EFFECTS', 'Chroma foreground and background sizes must match.');
  }
  const config = chromaOptions(options);
  const keyIndex = config.key === 'green' ? 1 : 2;
  const otherIndex = config.key === 'green' ? 2 : 1;
  const innerSquared = config.threshold * config.threshold;
  const outer = config.threshold + config.softness;
  const outerSquared = outer * outer;
  for (let offset = 0; offset < foreground.length; offset += 4) {
    const red = foreground[offset];
    const other = foreground[offset + otherIndex];
    const dominant = foreground[offset + keyIndex];
    const sum = red + other + dominant;
    // Near-black pixels are retained, avoiding amplification of sensor noise.
    const distanceSquared = sum > 12 ? (red * red + red * other + other * other) / (sum * sum) : 1;
    let mask = 1;
    if (distanceSquared <= innerSquared) mask = 0;
    else if (distanceSquared < outerSquared) {
      const position = clamp((Math.sqrt(distanceSquared) - config.threshold) / config.softness, 0, 1);
      mask = position * position * (3 - 2 * position);
    }
    const coverage = mask * foreground[offset + 3] / 255;
    if (coverage === 1) continue;
    if (coverage === 0) {
      foreground[offset] = background[offset];
      foreground[offset + 1] = background[offset + 1];
      foreground[offset + 2] = background[offset + 2];
      foreground[offset + 3] = 255;
      continue;
    }
    const correctedDominant = dominant - Math.max(0, dominant - Math.max(red, other)) * config.spill * (1 - mask);
    for (let channel = 0; channel < 3; channel += 1) {
      const value = channel === keyIndex ? correctedDominant : foreground[offset + channel];
      foreground[offset + channel] = value * coverage + background[offset + channel] * (1 - coverage);
    }
    foreground[offset + 3] = 255;
  }
  return foreground;
}

function canvas(width, height) {
  const surface = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
  surface.width = width; surface.height = height;
  const context = surface.getContext('2d', { willReadFrequently: true });
  if (!context) throw fail('EFFECTS_UNAVAILABLE', 'This browser cannot create a drawing surface for video effects.');
  return { surface, context };
}

function imageSize(image) {
  return { width: image.naturalWidth || image.videoWidth || image.width, height: image.naturalHeight || image.videoHeight || image.height };
}

function drawCover(context, image, width, height) {
  const dimensions = imageSize(image);
  if (!(dimensions.width > 0 && dimensions.height > 0)) throw fail('INVALID_EFFECTS', 'The background image has not finished loading.');
  const scale = Math.max(width / dimensions.width, height / dimensions.height);
  const cropWidth = width / scale, cropHeight = height / scale;
  context.drawImage(image, (dimensions.width - cropWidth) / 2, (dimensions.height - cropHeight) / 2, cropWidth, cropHeight, 0, 0, width, height);
}

function wrapText(context, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth) { line = candidate; continue; }
      if (line) lines.push(line);
      line = '';
      for (const character of word) {
        if (line && context.measureText(line + character).width > maxWidth) { lines.push(line); line = character; }
        else line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawText(context, text, width, height, textStyle, title = false, avoid = null) {
  if (!text.trim()) return null;
  if (text.length > 10000) throw fail('EFFECTS_TEXT_TOO_LONG', 'This caption is too long. Split it into shorter timed captions.');
  const safeX = Math.max(4, width * 0.045);
  const safeY = Math.max(4, height * 0.055);
  const maxWidth = width - 2 * safeX;
  const maxHeight = Math.min(height * (title ? 0.38 : 0.72), height - safeY * 2);
  const base = Math.min(width * (title ? 0.062 : 0.047), height * (title ? 0.095 : 0.07));
  let size = Math.max(8, Math.round(base * SIZES[textStyle.size]));
  let lines, padding, lineHeight, boxWidth, boxHeight, fits = false;
  for (; size >= 8; size -= 1) {
    context.font = `${title ? 700 : 600} ${size}px ${FONT}`;
    padding = size * 0.45;
    lineHeight = size * 1.25;
    lines = wrapText(context, text, maxWidth - padding * 2);
    boxWidth = Math.max(...lines.map(line => context.measureText(line).width)) + padding * 2;
    boxHeight = lines.length * lineHeight + padding * 2;
    if (boxHeight <= maxHeight && boxWidth <= maxWidth) { fits = true; break; }
  }
  if (!fits) throw fail('EFFECTS_TEXT_TOO_LONG', `${title ? 'The title' : 'A caption'} is too long to fit. Use less text or split it into shorter cues.`);
  const x = (width - boxWidth) / 2;
  let y = textStyle.position === 'top' ? safeY : textStyle.position === 'center' ? (height - boxHeight) / 2 : height - safeY - boxHeight;
  if (avoid && y < avoid.y + avoid.height && y + boxHeight > avoid.y) {
    const gap = Math.max(6, height * 0.02);
    const above = avoid.y - gap - boxHeight;
    const below = avoid.y + avoid.height + gap;
    const candidates = textStyle.position === 'top' ? [below, above] : [above, below];
    const available = candidates.find(candidate => candidate >= safeY && candidate + boxHeight <= height - safeY);
    if (available === undefined) throw fail('EFFECTS_TEXT_TOO_LONG', 'The title and caption cannot both fit. Shorten the text or choose different positions.');
    y = available;
  }
  if (textStyle.background && textStyle.backgroundOpacity > 0) {
    context.globalAlpha = textStyle.backgroundOpacity;
    context.fillStyle = textStyle.backgroundColor;
    context.fillRect(x, y, boxWidth, boxHeight);
  }
  context.globalAlpha = 1;
  context.fillStyle = textStyle.color;
  context.textAlign = 'center'; context.textBaseline = 'top';
  for (let index = 0; index < lines.length; index += 1) context.fillText(lines[index], width / 2, y + padding + index * lineHeight);
  return { x, y, width: boxWidth, height: boxHeight, fontSize: size, lineCount: lines.length, text };
}

/**
 * All times are seconds on the ORIGINAL source-video timeline. Background image
 * must already be decoded (ImageBitmap, HTMLImageElement or canvas). Call draw()
 * AFTER drawing the cropped source frame and BEFORE an optional logo. This API
 * performs no asset loading, audio handling, encoding, timers or network calls.
 */
export function createCompositor({ width, height, title = {}, captionStyle = {}, chroma = {}, backgroundImage } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 32 || height < 32 || width * height > 33554432) {
    throw fail('INVALID_EFFECTS', 'Choose valid video dimensions between 32 pixels and 32 megapixels.');
  }
  if (typeof title === 'string') title = { text: title };
  if (!title || typeof title !== 'object' || Array.isArray(title)) throw fail('INVALID_EFFECTS', 'Use valid title settings.');
  const titleText = title.text ?? '';
  if (typeof titleText !== 'string' || titleText.length > 1000) throw fail('INVALID_EFFECTS', 'Use a title of at most 1,000 characters.');
  const titleStyle = style(title, { position: 'top', opacity: 0.65 });
  const subtitleStyle = style(captionStyle);
  const titleStart = number(title.start, 0, 0, Number.MAX_SAFE_INTEGER, 'Title start');
  const titleEnd = title.end ?? Infinity;
  if (typeof titleEnd !== 'number' || Number.isNaN(titleEnd) || titleEnd <= titleStart) throw fail('INVALID_EFFECTS', 'Title end must be later than title start.');
  const key = chromaOptions(chroma);
  let backgroundSurface = null, backgroundPixels = null, disposed = false;
  if (key.enabled) {
    const background = canvas(width, height);
    backgroundSurface = background.surface;
    try {
      background.context.fillStyle = key.backgroundColor;
      background.context.fillRect(0, 0, width, height);
      if (backgroundImage) drawCover(background.context, backgroundImage, width, height);
      backgroundPixels = background.context.getImageData(0, 0, width, height).data;
    } catch (cause) {
      backgroundSurface.width = 0; backgroundSurface.height = 0;
      throw fail('EFFECTS_BACKGROUND_FAILED', 'The background image could not be used. Choose a local PNG or JPEG image.', cause);
    }
  }
  return {
    draw(context, { time = 0, captions = [] } = {}) {
      if (disposed) throw fail('EFFECTS_DISPOSED', 'This video compositor has already been closed.');
      if (!context || context.canvas.width !== width || context.canvas.height !== height) throw fail('INVALID_EFFECTS', 'The video frame dimensions do not match the compositor.');
      if (!Number.isFinite(time) || time < 0 || !Array.isArray(captions)) throw fail('INVALID_EFFECTS', 'Use a valid source-video time and caption list.');
      const active = [];
      for (const cue of captions) {
        if (!cue || typeof cue.text !== 'string' || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start) throw fail('INVALID_EFFECTS', 'A caption has invalid text or timing.');
        if (cue.start <= time && cue.end > time) active.push(cue.text);
      }
      context.save();
      try {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
        if (key.enabled) {
          let frame;
          try { frame = context.getImageData(0, 0, width, height); }
          catch (cause) { throw fail('EFFECTS_READ_FAILED', 'This browser could not read the local video pixels for chroma key.', cause); }
          applyChromaToPixels(frame.data, backgroundPixels, key);
          context.putImageData(frame, 0, 0);
        }
        const titleLayout = titleText && time >= titleStart && time < titleEnd ? drawText(context, titleText, width, height, titleStyle, true) : null;
        const captionLayout = active.length ? drawText(context, active.join('\n'), width, height, subtitleStyle, false, titleLayout) : null;
        return { title: titleLayout || null, caption: captionLayout, chroma: key.enabled };
      } finally { context.restore(); }
    },
    dispose() {
      disposed = true;
      backgroundPixels = null;
      if (backgroundSurface) { backgroundSurface.width = 0; backgroundSurface.height = 0; backgroundSurface = null; }
    },
  };
}
