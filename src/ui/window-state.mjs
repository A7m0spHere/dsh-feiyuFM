// Where the panel sits, and how it comes back.
//
// MVP requires position memory and, after a monitor is disconnected or the DPI
// changes, that the window returns to a visible area (MVP section 5). The second
// part is the interesting one: a remembered position can easily be off-screen
// once the display layout changes, and a window nobody can reach is worse than a
// window in the default corner.
//
// All of this is pure geometry, so it is testable without a desktop shell:
// displays are passed in as rectangles.

/** Stored under one settings key; the shape is versioned so it can evolve. */
export const WINDOW_STATE_KEY = 'window';

const DEFAULT_SIZE = Object.freeze({ width: 220, height: 260 });
const MIN_VISIBLE_PX = 48;

function isRect(value) {
  return value && ['x', 'y', 'width', 'height'].every((field) => Number.isFinite(value[field]));
}

function intersect(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * How much of a rect is on any display.
 * A window counts as reachable when a usable corner of it is visible, not when
 * any single pixel is.
 */
export function visibleArea(rect, displays) {
  if (!isRect(rect) || !Array.isArray(displays) || !displays.length) return 0;
  let best = 0;
  for (const display of displays) {
    if (!isRect(display)) continue;
    const overlap = intersect(rect, display);
    if (overlap) best = Math.max(best, overlap.width * overlap.height);
  }
  return best;
}

/** Clamps a size so it fits a display, keeping it usable rather than vanishing. */
export function clampSize(rect, displays, minimum = { width: 120, height: 120 }) {
  const display = displays.find((candidate) => isRect(candidate)) ?? null;
  if (!display) return { ...rect };
  return {
    ...rect,
    width: Math.max(minimum.width, Math.min(rect.width, display.width)),
    height: Math.max(minimum.height, Math.min(rect.height, display.height)),
  };
}

/** Places a rect fully inside a display, preferring the display it is nearest to. */
export function placeInside(rect, displays) {
  const usable = displays.filter((candidate) => isRect(candidate));
  if (!usable.length) return { ...rect };
  const sized = clampSize(rect, usable);
  // Pick the display the rect already overlaps most; otherwise the first one.
  let target = usable[0];
  let bestOverlap = -1;
  for (const display of usable) {
    const overlap = intersect(sized, display);
    const area = overlap ? overlap.width * overlap.height : 0;
    if (area > bestOverlap) {
      bestOverlap = area;
      target = display;
    }
  }
  const margin = 8;
  return {
    ...sized,
    x: Math.min(Math.max(sized.x, target.x + margin), target.x + target.width - sized.width - margin),
    y: Math.min(Math.max(sized.y, target.y + margin), target.y + target.height - sized.height - margin),
  };
}

/**
 * Decides where the panel should appear.
 *
 * @param {object} options
 * @param {object} options.store   MusicStore holding the remembered rect
 * @param {Array} options.displays Current display rectangles
 * @param {object} [options.fallback] Where to put it when nothing is remembered
 * @returns {{ rect: object, source: string, reason: string|null, remembered: object|null }}
 */
export function restoreWindowState({ store, displays, fallback = null, scaleFactor = null } = {}) {
  const usable = (displays ?? []).filter((display) => isRect(display));
  const base = fallback && isRect(fallback)
    ? fallback
    : (usable[0]
      ? { x: usable[0].x + usable[0].width - DEFAULT_SIZE.width - 24, y: usable[0].y + 24, ...DEFAULT_SIZE }
      : { x: 0, y: 0, ...DEFAULT_SIZE });

  let remembered = null;
  try {
    remembered = store?.getSetting?.(WINDOW_STATE_KEY, null) ?? null;
  } catch {
    remembered = null;
  }

  if (!isRect(remembered)) {
    return { rect: placeInside(base, usable), source: 'default', reason: 'no usable position was remembered', remembered: null };
  }

  const visible = visibleArea(remembered, usable);
  if (!usable.length) {
    // No display information: hand the remembered rect back untouched rather
    // than inventing a layout.
    return { rect: { ...remembered }, source: 'remembered', reason: 'no display information was available', remembered };
  }
  if (visible < MIN_VISIBLE_PX * MIN_VISIBLE_PX) {
    return {
      rect: placeInside(base, usable),
      source: 'recovered',
      reason: 'the remembered position is no longer on any display (a monitor may have been disconnected)',
      remembered,
    };
  }

  // A remembered rect was recorded in the coordinate units of the display it was
  // on. Measured on this machine (P0-05): at 125% scaling, WPF reports 120 for a
  // physical 150, so a position stored at one scale drifts if it is reused at
  // another. Converting is what keeps the window where the user put it.
  const dpiChanged = Number.isFinite(scaleFactor) && Number.isFinite(remembered.scaleFactor)
    && scaleFactor !== remembered.scaleFactor;
  if (dpiChanged && remembered.scaleFactor > 0) {
    const ratio = scaleFactor / remembered.scaleFactor;
    const converted = {
      x: Math.round(remembered.x * ratio),
      y: Math.round(remembered.y * ratio),
      width: Math.round(remembered.width * ratio),
      height: Math.round(remembered.height * ratio),
      scaleFactor,
    };
    const stillVisible = visibleArea(converted, usable) >= MIN_VISIBLE_PX * MIN_VISIBLE_PX;
    if (stillVisible) {
      return {
        rect: placeInside(converted, usable),
        source: 'rescaled',
        reason: `the display scale changed from ${remembered.scaleFactor} to ${scaleFactor}, so the position was converted`,
        remembered,
      };
    }
  }

  // A DPI change can also make a remembered size too large for the display.
  const sized = clampSize(remembered, usable);
  if (sized.width !== remembered.width || sized.height !== remembered.height || dpiChanged) {
    return {
      rect: placeInside(sized, usable),
      source: 'resized',
      reason: dpiChanged
        ? 'the display scale changed, so the size was clamped to fit'
        : 'the remembered size is larger than the display, so it was clamped',
      remembered,
    };
  }
  return { rect: sized, source: 'remembered', reason: null, remembered };
}

/**
 * Remembers a rect. Off-screen positions are stored as they are: the user's
 * intent is kept, and `restoreWindowState` decides whether it is still usable.
 */
export function saveWindowState(store, rect, { scaleFactor = null, now = Date.now() } = {}) {
  if (!isRect(rect)) throw new Error('A rectangle with numeric x, y, width and height is required');
  const value = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    ...(Number.isFinite(scaleFactor) ? { scaleFactor } : {}),
    savedAt: now,
  };
  store.setSetting(WINDOW_STATE_KEY, value);
  return value;
}

export function forgetWindowState(store) {
  return store.removeSetting?.(WINDOW_STATE_KEY) ?? null;
}