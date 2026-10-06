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
      const g = dollShape(body, world);
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

test('rotation and collision deformation fit narrow, tall and temporarily collapsed viewports', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (const [width, height, count] of [[272, 620, 6], [272, 1800, 6], [96, 620, 6], [272, 440, 1], [1, 1, 6]]) {
    const world = createDollWorld(width, height, Array(count).fill(1), random);
    for (let frame = 0; frame < 600; frame++) {
      world.step(1 / 60);
      for (const body of world.bodies) {
        const g = dollShape(body, world);
        assert.ok(body.x + g.dx - g.hx >= -.001 && body.x + g.dx + g.hx <= width + .001, `${width}x${height}: horizontal clipping`);
        assert.ok(body.y + g.dy - g.hy >= -.001 && body.y + g.dy + g.hy <= height + .001, `${width}x${height}: vertical clipping`);
        const original = dollShape(body);
        assert.ok(Math.abs(g.width / g.height - original.width / original.height) < 1e-9, 'fitting must preserve the deformed proportions');
      }
    }
  }
});
