import assert from 'node:assert/strict';
import test from 'node:test';
import { RiverOverlay } from '../frontend/src/river-overlay.ts';

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(create) {
  const host = { dataset: {} };
  const calls = [];
  const renderers = [];
  let loads = 0;
  const overlay = new RiverOverlay(host, () => {}, async () => {
    ++loads;
    return { createRiverRenderer: async (world, view, host, onFailure) => {
      const renderer = { destroyed: 0, views: [], months: [], setMonth(next) { this.months.push(next); }, setView(next) { this.views.push(next); }, destroy() { ++this.destroyed; } };
      const call = { world, view, host, onFailure, renderer };
      calls.push(call);
      renderers.push(renderer);
      return create ? create(call) : renderer;
    } };
  });
  overlay.setView({ scale: 1 });
  overlay.setWorld({ seed: 'old' });
  return { overlay, host, calls, renderers, get loads() { return loads; } };
}

test('ordinary map never loads Pixi; enabling and disabling releases its renderer', async () => {
  const ctx = setup();
  await flush();
  assert.equal(ctx.loads, 0);
  ctx.overlay.setVisible(true);
  assert.equal(ctx.host.dataset.riverRenderer, 'loading');
  await flush();
  assert.equal(ctx.host.dataset.riverRenderer, 'gpu');
  ctx.overlay.setView({ scale: 3 });
  assert.equal(ctx.renderers[0].views.at(-1).scale, 3);
  ctx.overlay.setVisible(false);
  assert.equal(ctx.host.dataset.riverRenderer, 'off');
  assert.equal(ctx.renderers[0].destroyed, 1);
});

test('closing the overlay during initialization destroys the late renderer', async () => {
  const gate = deferred();
  const ctx = setup(async ({ renderer }) => { await gate.promise; return renderer; });
  ctx.overlay.setVisible(true);
  await flush();
  ctx.overlay.setVisible(false);
  gate.resolve();
  await flush();
  assert.equal(ctx.renderers[0].destroyed, 1);
  assert.equal(ctx.host.dataset.riverRenderer, 'off');
});

test('world replacement serializes GPU initialization and uses the newest camera', async () => {
  const gate = deferred();
  const ctx = setup(async ({ world, renderer }) => {
    if (world.seed === 'old') await gate.promise;
    return renderer;
  });
  ctx.overlay.setVisible(true);
  await flush();
  ctx.overlay.setWorld({ seed: 'new' });
  ctx.overlay.setView({ scale: 4 });
  await flush();
  assert.equal(ctx.calls.length, 1);
  gate.resolve();
  await flush();
  assert.equal(ctx.calls.length, 2);
  assert.equal(ctx.renderers[0].destroyed, 1);
  assert.equal(ctx.calls[1].world.seed, 'new');
  assert.equal(ctx.renderers[1].views.at(-1).scale, 4);
  assert.equal(ctx.host.dataset.riverRenderer, 'gpu');
  ctx.overlay.destroy();
});

test('GPU creation failure and context loss fall back, with explicit re-enable retry', async () => {
  let fail = true;
  const ctx = setup(({ renderer }) => { if (fail) throw Error('WebGL unavailable'); return renderer; });
  ctx.overlay.setVisible(true);
  await flush();
  assert.equal(ctx.host.dataset.riverRenderer, 'fallback');
  fail = false;
  ctx.overlay.setVisible(false);
  ctx.overlay.setVisible(true);
  await flush();
  assert.equal(ctx.host.dataset.riverRenderer, 'gpu');
  ctx.calls.at(-1).onFailure();
  assert.equal(ctx.renderers.at(-1).destroyed, 1);
  assert.equal(ctx.host.dataset.riverRenderer, 'fallback');
  ctx.overlay.destroy();
});

test('destroying while the module loads prevents GPU initialization entirely', async () => {
  const gate = deferred();
  let creates = 0;
  const overlay = new RiverOverlay({ dataset: {} }, () => {}, async () => {
    await gate.promise;
    return { createRiverRenderer() { ++creates; throw Error('must not initialize'); } };
  });
  overlay.setView({ scale: 1 });
  overlay.setWorld({});
  overlay.setVisible(true);
  await flush();
  overlay.destroy();
  gate.resolve();
  await flush();
  assert.equal(creates, 0);
});

test('rendering errors release GPU resources and preserve fallback state', async () => {
  const ctx = setup();
  ctx.overlay.setVisible(true);
  await flush();
  ctx.renderers[0].setView = () => { throw Error('render failed'); };
  ctx.overlay.setView({ scale: 2 });
  assert.equal(ctx.host.dataset.riverRenderer, 'fallback');
  assert.equal(ctx.renderers[0].destroyed, 1);
});

test('month selected while GPU initializes is applied on arrival and survives re-enable', async () => {
  const gate = deferred();
  const ctx = setup(async ({ renderer }) => { await gate.promise; return renderer; });
  ctx.overlay.setVisible(true);
  await flush();
  ctx.overlay.setMonth(7);
  gate.resolve();
  await flush();
  assert.equal(ctx.renderers[0].months.at(-1), 7);
  ctx.overlay.setMonth(0);
  assert.equal(ctx.renderers[0].months.at(-1), 0);
  ctx.overlay.setVisible(false);
  ctx.overlay.setMonth(undefined);
  ctx.overlay.setVisible(true);
  await flush();
  assert.equal(ctx.renderers[1].months.at(-1), undefined);
  ctx.overlay.destroy();
});
