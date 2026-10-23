import test from 'node:test';
import assert from 'node:assert/strict';
import { validNaturalDetail, terrainPixels } from '../frontend/src/terrain-raster.ts';
import { detailLayout } from '../frontend/src/map-detail-layout.ts';
const palette = Array.from({length: 12}, (_, i) => [30 + i * 12, 60 + i * 9, 35 + i * 7]);
const detail = { version: 1, columns: 2, rows: 2, terrain: [2, 4, 7, 9], shade: [128, 160, 96, 128], symbols: [] };

test('invalid/old detail fails closed without silently reinterpreting fields', () => {
  for (const d of [undefined, {...detail, version: 2}, {...detail, columns: 1.5}, {...detail, rows: 1000000}, {...detail, shade: [128]}, {...detail, terrain: [2, 4, 999, 2]}, {...detail, shade: [NaN, 1, 1, 1]}]) assert.equal(validNaturalDetail(d), false);
  assert.equal(validNaturalDetail(detail), true);
});
test('raster has full coverage, is deterministic and never mutates model arrays', () => {
  const before = structuredClone(detail);
  const a = terrainPixels(detail, palette, true);
  assert.equal(a.width, 8); assert.equal(a.height, 8);
  for (let i = 3; i < a.pixels.length; i += 4) assert.equal(a.pixels[i], 255);
  assert.deepEqual(a, terrainPixels(detail, palette, true));
  assert.deepEqual(detail, before);
});
test('uniform neutral terrain preserves the legend colour with or without shading', () => {
  const flat = {...detail, terrain: [4, 4, 4, 4], shade: [128, 128, 128, 128]};
  for (const shaded of [true, false]) {
    const a = terrainPixels(flat, palette, shaded);
    for (let i = 0; i < a.pixels.length; i += 4) assert.deepEqual([...a.pixels.slice(i, i + 4)], [...palette[4], 255]);
  }
});
test('lighting changes intensity but not data and can be disabled', () => {
  assert.notDeepEqual(terrainPixels(detail, palette, true).pixels, terrainPixels(detail, palette, false).pixels);
});
test('water colour never bleeds into land blending and lake category is not averaged as an ID', () => {
  const water = {...detail, terrain: [4, 0, 10, 4], shade: [128, 128, 128, 128]};
  const a = terrainPixels(water, palette, false, 1);
  assert.deepEqual([...a.pixels.slice(0, 4)], [...palette[4], 255]);
  assert.deepEqual([...a.pixels.slice(12, 16)], [...palette[4], 255]);
});
test('edge transition uses only neighbouring colours and has no alpha cracks', () => {
  const d = {...detail, terrain: [2, 4, 2, 4], shade: [128, 128, 128, 128]};
  const p = terrainPixels(d, palette, false).pixels;
  for (let i = 0; i < p.length; i += 4) for (let c = 0; c < 3; c++) assert.ok(p[i + c] >= palette[2][c] && p[i + c] <= palette[4][c]);
});
const world = { cells: Array.from({length: 200}, (_, id) => ({id, land_fraction: 1, area: 5000,
  centroid: {x: 100 + id % 20 * 60, y: 100 + Math.floor(id / 20) * 70}, construction: {land_anchor: null}})),
  environment: { natural_surface: {detail: {symbols: [{position: {x: 550, y: 500}, terrain: 4}, {position: {x: 700, y: 500}, terrain: 7}]}}} };
const view = {width: 1600, height: 1000, viewportWidth: 1600, viewportHeight: 1000, pixelRatio: 1, scale: 1, tx: 0, ty: 0};
test('detail LOD uses actual screen scale and suppresses clutter on small screens', () => {
  assert.equal(detailLayout(world, {...view, viewportWidth: 390, viewportHeight: 844}).symbols.length, 0);
  assert.equal(detailLayout(world, view).labels.length, 0);
  assert.deepEqual(detailLayout(world, view).symbols.map(s => s.terrain), [7]);
  const zoom = detailLayout(world, {...view, scale: 2});
  assert.ok(zoom.labels.length > 0 && zoom.labels.length <= 32);
  assert.ok(zoom.symbols.length <= 160);
  for (const l of zoom.labels) assert.ok(world.cells.some(c => c.id === l.id));
});
test('screen layout is deterministic, bounded and does not mutate governance data', () => {
  const before = structuredClone(world);
  const a = detailLayout(world, {...view, scale: 2, selectedId: 10});
  assert.deepEqual(a, detailLayout(world, {...view, scale: 2, selectedId: 10}));
  assert.deepEqual(world, before);
  for (let i = 0; i < a.labels.length; i++) for (let j = i + 1; j < a.labels.length; j++) {
    assert.ok(Math.abs(a.labels[i].position.x - a.labels[j].position.x) * a.scale >= 46 || Math.abs(a.labels[i].position.y - a.labels[j].position.y) * a.scale >= 24);
  }
});
