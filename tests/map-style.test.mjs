import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveMapStyle, naturalTerrainPaints } from '../frontend/src/map-style.ts';

const world = { environment: {
  terrain_palette: ['deep_ocean', 'shallow_sea', 'plains', 'forest'],
  natural_surface: { version: 1, terrain: [{ terrain: 3, path: 'M0,0L1,0L0,1Z' }] },
} };

test('natural is opt-in and only applies to terrain with supported data', () => {
  assert.equal(effectiveMapStyle('classic', 'terrain', world), 'classic');
  assert.equal(effectiveMapStyle('natural', 'terrain', world), 'natural');
  for (const layer of ['elevation', 'temperature', 'rainfall', 'water', 'soil', 'agriculture', 'resources', 'geology', 'construction']) {
    assert.equal(effectiveMapStyle('natural', layer, world), 'classic');
  }
  assert.equal(effectiveMapStyle('natural', 'terrain'), 'classic');
  assert.equal(effectiveMapStyle('natural', 'terrain', { environment: {} }), 'classic');
  assert.equal(effectiveMapStyle('natural', 'terrain', { environment: { natural_surface: { version: 2 } } }), 'classic');
});

test('SVG and minimap paint plan shares source geometry without mutating it', () => {
  const before = structuredClone(world);
  assert.deepEqual(naturalTerrainPaints(world), [{ terrain: 'forest', path: 'M0,0L1,0L0,1Z' }]);
  assert.deepEqual(world, before);
  assert.deepEqual(naturalTerrainPaints({ environment: { terrain_palette: [], natural_surface: { terrain: [{ terrain: 999, path: 'M0,0Z' }] } } }), []);
});
