import test from 'node:test';
import assert from 'node:assert/strict';
import { createDollWorld, dollShape } from '../src/ui/client/doll-world.mjs';

test('flying dolls keep their original proportions and remain bounded through rotation, collisions and resizing', () => {
  let seed = 31;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const world = createDollWorld(980, 620, [1, 1.1, .8, 1, .9, 1.2], random);
  for (let i = 0; i < 3600; i++) {
    if (i === 1800) world.resize(272, 440);
    world.step(1 / 60);
    for (const body of world.bodies) {
      const g = dollShape(body);
      assert.ok(Number.isFinite(body.x + body.y + body.angle + body.squash));
      assert.ok(body.x + g.dx - g.hx >= -.001 && body.x + g.dx + g.hx <= world.width + .001);
      assert.ok(body.y + g.dy - g.hy >= -.001 && body.y + g.dy + g.hy <= world.height + .001);
      assert.ok(g.width > 0 && g.height > 0);
      assert.ok(body.squash >= -.15 && body.squash <= .55);
    }
  }
});

test('head-on dolls rebound rather than passing through each other', () => {
  const world = createDollWorld(900, 600, [1, 1], () => .5);
  const [a, b] = world.bodies;
  Object.assign(a, { x: 360, y: 300, vx: 200, vy: 0, angle: 0, spin: 0 });
  Object.assign(b, { x: 520, y: 300, vx: -200, vy: 0, angle: 0, spin: 0 });
  world.step(1 / 60);
  assert.ok(a.vx < 0 && b.vx > 0);
});
