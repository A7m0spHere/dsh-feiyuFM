// Original panel simulation. Workshop parameters and image proportions are
// recorded in U12; no Workshop JavaScript is bundled into FishFM.
const dollClamp = (value, low, high) => Math.max(low, Math.min(high, value));
export function dollShape(body) {
  const width = body.size * Math.min(1, body.aspect) * (1 + body.squash);
  const baseHeight = body.size / Math.max(1, body.aspect);
  const height = baseHeight * (1 - body.squash);
  const offset = (baseHeight - height) / 2;
  const c = Math.abs(Math.cos(body.angle)), s = Math.abs(Math.sin(body.angle));
  return { width, height, offset, dx: -offset * Math.sin(body.angle), dy: offset * Math.cos(body.angle),
    hx: (width * c + height * s) / 2, hy: (width * s + height * c) / 2 };
}

export function createDollWorld(width, height, aspects, random = Math.random) {
  const bodies = aspects.map(aspect => ({ aspect, x: 0, y: 0, size: 1, vx: 0, vy: 0,
    angle: random() * Math.PI * 2, spin: (random() < .5 ? -1 : 1) * (.45 + random() * .9),
    squash: 0, spring: 0, pressure: 0 }));
  const world = { width: 1, height: 1, bodies, elapsed: 0, resize, step };
  function resize(w, h) {
    const oldWidth = world.width, oldHeight = world.height;
    world.width = Math.max(1, w); world.height = Math.max(1, h);
    const cols = Math.max(1, Math.min(bodies.length, Math.ceil(Math.sqrt(bodies.length * world.width / world.height))));
    const rows = Math.max(1, Math.ceil(bodies.length / cols));
    const size = Math.min(180, world.width / cols / 1.45, world.height / rows / 1.45);
    bodies.forEach((body, index) => {
      body.size = size;
      if (oldWidth === 1 && oldHeight === 1) {
        body.x = (index % cols + .5) * world.width / cols;
        body.y = (Math.floor(index / cols) + .5) * world.height / rows;
        const direction = random() * Math.PI * 2;
        // One short scatter, followed by the reference's normal 85 px/s drift.
        body.vx = Math.cos(direction) * 255; body.vy = Math.sin(direction) * 255;
      } else { body.x *= world.width / oldWidth; body.y *= world.height / oldHeight; }
      walls(body);
    });
  }
  function walls(body) {
    const g = dollShape(body);
    const left = Math.min(world.width / 2, g.hx - g.dx), right = Math.max(world.width / 2, world.width - g.hx - g.dx);
    const top = Math.min(world.height / 2, g.hy - g.dy), bottom = Math.max(world.height / 2, world.height - g.hy - g.dy);
    if (body.x < left || body.x > right) {
      body.x = dollClamp(body.x, left, right);
      if ((body.x === left && body.vx < 0) || (body.x === right && body.vx > 0)) body.vx *= -1;
    }
    if (body.y < top || body.y > bottom) {
      body.y = dollClamp(body.y, top, bottom);
      if ((body.y === top && body.vy < 0) || (body.y === bottom && body.vy > 0)) body.vy *= -1;
    }
  }
  function step(seconds) {
    const dt = dollClamp(seconds, 0, .05), steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
    for (let tick = 0; tick < steps; tick++) {
      world.elapsed += h;
      // A local animation clock, not a measurement of WPF audio or song beats.
      const phase = world.elapsed % 1.15;
      const pulse = phase < .5 ? Math.cos(phase / .5 * Math.PI * 2) * .15 : 0;
      for (const body of bodies) {
        const speed = Math.hypot(body.vx, body.vy);
        if (speed > .001) {
          const next = 85 + (speed - 85) * Math.exp(-4.8 / 3 * h);
          body.vx *= next / speed; body.vy *= next / speed;
        }
        body.x += body.vx * h; body.y += body.vy * h;
        body.angle = (body.angle + body.spin * h) % (Math.PI * 2);
        const target = body.pressure > .02 ? Math.min(.5, .14 + body.pressure * .38) : pulse;
        body.spring += (1000 * (target - body.squash) - 52 * body.spring) * h;
        body.squash = dollClamp(body.squash + body.spring * h, -.15, .55);
        body.pressure *= Math.exp(-h / .18);
        walls(body);
      }
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j], dx = b.x - a.x, dy = b.y - a.y;
        const distance = Math.hypot(dx, dy), reach = (a.size + b.size) * .46;
        if (distance >= reach) continue;
        const nx = distance > .001 ? dx / distance : 1, ny = distance > .001 ? dy / distance : 0;
        const ia = 1 / (a.size * a.size), ib = 1 / (b.size * b.size), sum = ia + ib;
        const overlap = reach - distance;
        a.x -= nx * overlap * ia / sum; a.y -= ny * overlap * ia / sum;
        b.x += nx * overlap * ib / sum; b.y += ny * overlap * ib / sum;
        const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (closing < 0) {
          a.vx += 2 * closing * nx * ia / sum; a.vy += 2 * closing * ny * ia / sum;
          b.vx -= 2 * closing * nx * ib / sum; b.vy -= 2 * closing * ny * ib / sum;
          a.pressure = b.pressure = Math.min(1, .35 + Math.abs(closing) / 600);
        }
        walls(a); walls(b);
      }
    }
  }
  resize(width, height);
  return world;
}
