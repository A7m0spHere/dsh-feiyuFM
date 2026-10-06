import React from 'react';
import { h } from './shared.mjs';
import { createDollWorld, dollShape } from './doll-world.mjs';

const dollIds = ['glm', 'deepseek', 'claude', 'gemini', 'gpt', 'grok'];
export function DollLayer({ active, motion, names = [] }) {
  const canvasRef = React.useRef(null);
  const [reduced, setReduced] = React.useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  React.useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return undefined;
    const change = () => setReduced(media.matches);
    media.addEventListener?.('change', change);
    return () => media.removeEventListener?.('change', change);
  }, []);
  const key = dollIds.filter(name => names.includes(name)).join(',');
  const running = active && (motion || 'full') === 'full' && !reduced && Boolean(key);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!running || !canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const panel = canvas.closest('.fishfm');
    let disposed = false, frame = 0, previous = null, visible = true, world;
    let width = 1, height = 1, ratio = 1;
    const sprites = [];
    const resize = () => {
      const style = window.getComputedStyle(panel);
      width = Math.max(1, panel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
      height = Math.max(1, Math.min(panel.clientHeight, window.innerHeight - Math.max(0, panel.getBoundingClientRect().top))
        - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
      ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      world?.resize(width, height);
    };
    const draw = now => {
      frame = 0;
      if (disposed || document.hidden || !visible) { previous = null; return; }
      world.step(previous === null ? 0 : (now - previous) / 1000); previous = now;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
      world.bodies.forEach((body, index) => {
        const g = dollShape(body, world);
        ctx.save(); ctx.translate(body.x, body.y); ctx.rotate(body.angle);
        ctx.drawImage(sprites[index], -g.width / 2, g.offset - g.height / 2, g.width, g.height);
        ctx.restore();
      });
      frame = window.requestAnimationFrame(draw);
    };
    const resume = () => {
      if (!disposed && world && !document.hidden && visible && !frame) frame = window.requestAnimationFrame(draw);
      else if ((document.hidden || !visible) && frame) { window.cancelAnimationFrame(frame); frame = 0; previous = null; }
    };
    const observer = new ResizeObserver(resize); observer.observe(panel);
    const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting === true; resume();
    }) : null;
    intersection?.observe(canvas);
    document.addEventListener('visibilitychange', resume);
    resize();
    const requests = key.split(',').map(name => new Promise(resolve => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = () => resolve(null);
      image.src = `/fishfm/assets/dolls/doll-${name}.png`;
    }));
    Promise.all(requests).then(images => {
      if (disposed) return;
      sprites.push(...images.filter(Boolean));
      if (!sprites.length) return;
      world = createDollWorld(width, height, sprites.map(image => image.naturalWidth / image.naturalHeight));
      canvas.dataset.dolls = String(sprites.length); resume();
    });
    return () => {
      disposed = true; window.cancelAnimationFrame(frame); observer.disconnect(); intersection?.disconnect();
      document.removeEventListener('visibilitychange', resume);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [running, key]);
  return running ? h('div', { className: 'fm-doll-anchor', 'aria-hidden': true },
    h('canvas', { className: 'fm-doll-layer', ref: canvasRef })) : null;
}
