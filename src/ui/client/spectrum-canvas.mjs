import { FIELD_RAMP } from './spectrum-bars.mjs';

// 仅在初始化/字体变化时读一次小字形图集，按实际墨量排序。不是逐帧像素回读。
export function calibrateSpectrumRamp(context, font) {
  context.canvas.width = 32; context.canvas.height = 24;
  context.font = font; context.textBaseline = 'top';
  const density = [...FIELD_RAMP.trim()].map(glyph => {
    context.clearRect(0, 0, 32, 24);
    context.fillStyle = '#000'; context.fillText(glyph, 4, 4);
    const pixels = context.getImageData(0, 0, 32, 24).data;
    let ink = 0;
    for (let i = 3; i < pixels.length; i += 4) ink += pixels[i];
    return { glyph, ink };
  });
  density.sort((a, b) => a.ink - b.ink);
  return ' ' + density.map(entry => entry.glyph).join('');
}

export function drawSpectrumScene(context, scene, { width, height, font, color, pixelRatio = 1 } = {}) {
  if (!context || !(width > 0) || !(height > 0)) return 0;
  const ratio = Math.max(1, Math.min(2, Number(pixelRatio) || 1));
  const canvas = context.canvas;
  const w = Math.round(width * ratio), h = Math.round(height * ratio);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.font = font; context.fillStyle = color;
  context.textAlign = 'center'; context.textBaseline = 'middle';
  const rows = scene.grid.length, cols = scene.grid[0]?.length ?? 0;
  if (!rows || !cols) return 0;
  const cellWidth = width / cols, cellHeight = height / rows;
  let glyphs = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const glyph = scene.grid[y][x];
    if (glyph === ' ') continue;
    const offset = scene.offsets[y]?.[x] || 0;
    context.fillText(glyph, (x + 0.5) * cellWidth, (y + 0.5 + offset) * cellHeight);
    glyphs++;
  }
  return glyphs;
}

export function createSpectrumPainter(canvas) {
  const context = canvas?.getContext?.('2d');
  if (!context) return null;
  let font = '', ramp = FIELD_RAMP;
  return {
    get ramp() { return ramp; },
    paint(scene) {
      const style = getComputedStyle(canvas);
      const nextFont = `${style.fontSize} ${style.fontFamily}`;
      if (font !== nextFont) {
        font = nextFont;
        try { ramp = calibrateSpectrumRamp(document.createElement('canvas').getContext('2d', { willReadFrequently: true }), font); }
        catch { ramp = FIELD_RAMP; }
      }
      return drawSpectrumScene(context, scene, { width: canvas.clientWidth, height: canvas.clientHeight,
        font, color: style.color, pixelRatio: window.devicePixelRatio });
    },
  };
}
