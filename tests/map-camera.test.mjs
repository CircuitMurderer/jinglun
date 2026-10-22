import assert from 'node:assert/strict';
import test from 'node:test';
import { MapCamera, screenTransform } from '../frontend/src/map-camera.ts';

function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`); }

test('SVG and GPU projections share letterboxing, pan and zoom at different aspect ratios', () => {
  for (const [width, height, pixelRatio] of [[960, 600, 1], [600, 960, 2], [1400, 420, 3]]) {
    const camera = new MapCamera();
    camera.setViewport(width, height, pixelRatio);
    camera.zoom(2.3, { x: 550, y: 350 });
    camera.pan(-150, 80);
    const view = camera.state;
    const fit = Math.min(width / 1600, height / 1000);
    const transform = screenTransform(view);
    for (const point of [{ x: 0, y: 0 }, { x: 740, y: 250 }, { x: 1600, y: 1000 }]) {
      const x = transform.x + point.x * transform.scale;
      const y = transform.y + point.y * transform.scale;
      // Independent SVG viewBox + g transform calculation.
      near(x, (width - 1600 * fit) / 2 + (view.tx + point.x * view.scale) * fit);
      near(y, (height - 1000 * fit) / 2 + (view.ty + point.y * view.scale) * fit);
      const local = camera.toView({ x, y });
      near((local.x - view.tx) / view.scale, point.x);
      near((local.y - view.ty) / view.scale, point.y);
    }
  }
});

test('zoom keeps the point under the pointer stationary and respects limits', () => {
  const camera = new MapCamera();
  const anchor = { x: 630, y: 280 };
  camera.zoom(2, anchor);
  near((anchor.x - camera.state.tx) / camera.state.scale, anchor.x);
  near((anchor.y - camera.state.ty) / camera.state.scale, anchor.y);
  camera.zoom(100);
  assert.equal(camera.state.scale, 7);
  camera.zoom(0.0001);
  assert.equal(camera.state.scale, 0.75);
  camera.pan(1e9, -1e9);
  near(camera.state.tx, 1420);
  near(camera.state.ty, -630);
});

test('resize preserves selection and camera; a new world resets them with its own dimensions', () => {
  const camera = new MapCamera();
  const updates = [];
  const unsubscribe = camera.subscribe((view) => updates.push(view));
  camera.select(8);
  camera.zoom(2);
  const before = camera.state;
  camera.setViewport(420, 700, 2);
  assert.equal(camera.state.selectedId, 8);
  assert.equal(camera.state.tx, before.tx);
  assert.equal(camera.state.scale, 2);
  assert.equal(before.viewportWidth, 1600);
  camera.setWorld(800, 500);
  assert.equal(camera.state.selectedId, undefined);
  assert.equal(camera.state.scale, 1);
  assert.deepEqual(screenTransform(camera.state), { scale: 0.525, x: 0, y: 218.75 });
  const count = updates.length;
  unsubscribe();
  camera.zoom(2);
  assert.equal(updates.length, count);
});
