import assert from 'node:assert/strict';
import test from 'node:test';
import { initialPins, reducePins, projectComparison } from '../frontend/src/comparison/model.ts';

const pin = (state, id) => reducePins(state, { type: 'pin', id });
test('candidates stay unique, ordered and bounded during assembly, removal and re-addition', () => {
  let state = pin(initialPins, 8);
  assert.deepEqual(state.ids, [8]);
  state = pin(state, 3);
  state = pin(state, 8);
  assert.deepEqual(state.ids, [8, 3]);
  assert.equal(state.feedback, 'duplicate');
  state = pin(pin(state, 11), 2);
  state = pin(state, 19);
  assert.deepEqual(state.ids, [8, 3, 11, 2]);
  assert.equal(state.feedback, 'limit');
  state = pin(state, 3);
  assert.equal(state.feedback, 'duplicate');
  state = reducePins(state, { type: 'remove', id: 3 });
  state = pin(state, 3);
  assert.deepEqual(state.ids, [8, 11, 2, 3]);
  assert.deepEqual(reducePins(state, { type: 'remove', id: 100 }).ids, state.ids);
  state = reducePins(state, { type: 'clear' });
  assert.deepEqual(state.ids, []);
  assert.deepEqual(reducePins(state, { type: 'clear' }), state);
});

function cell(id, land_fraction, sourceIds) {
  return { id, is_land: false, land_fraction, temperature_c: 9, rainfall_mm: 700,
    construction: { cost_multiplier: null }, resources: [{ kind: 'iron', potential: 73 }],
    minerals: [{ deposit_id: 41, reserve_units: 120, kind: 'iron' }],
    climate: { months: [{ temperature_c: -2, precipitation_mm: 20 }, { temperature_c: 18, precipitation_mm: 80 }] },
    groundwater: { months: [{ storage_mm: 10, baseflow_mm: 2 }, { storage_mm: 30, baseflow_mm: 5 }] },
    water_source_ids: sourceIds };
}
const world = {
  cells: [cell(8, 0.3, [99, 99, 17]), cell(3, 0, [99])],
  environment: { scale: { water_unit_m3: 2_000_000 }, water_sources: [
    { id: 17, outlet: 'boundary', months: [{ freshwater_ceiling: 4, ecological_reserve: 2, quality: 'fresh' }] },
    { id: 99, outlet: 'ocean', months: [{ freshwater_ceiling: 3, ecological_reserve: 1, quality: 'fresh' }, { freshwater_ceiling: 7, ecological_reserve: 4, quality: 'dry' }] },
  ] },
};
test('comparison uses annual climate, groundwater mean storage and summed baseflow; mixed land remains applicable', () => {
  const { candidates } = projectComparison(world, [8, 3, 500]);
  assert.deepEqual(candidates.map(value => value.cell.id), [8, 3]);
  assert.equal(candidates[0].temperature, 9);
  assert.equal(candidates[0].precipitation, 700);
  assert.equal(candidates[0].storage, 20);
  assert.equal(candidates[0].baseflow, 7);
  assert.equal(candidates[1].storage, null);
  assert.equal(candidates[1].baseflow, null);
  assert.equal(candidates[0].cell.construction.cost_multiplier, null);
  assert.equal(candidates[0].cell.resources[0].potential, 73);
  assert.equal(candidates[0].cell.minerals[0].reserve_units, 120);
});
test('shared sources retain identity, world numbering and members without multiplying quantities by member count', () => {
  const { sources } = projectComparison(world, [8, 3]);
  assert.deepEqual(sources.map(source => [source.id, source.number, source.members]), [[17, 1, [8]], [99, 2, [8, 3]]]);
  assert.equal(sources[1].ceiling, 20);
  assert.equal(sources[1].reserve, 10);
  assert.deepEqual(sources[1].qualities, ['fresh', 'dry']);
  const monthly = projectComparison(world, [3, 8], 1);
  assert.equal(monthly.candidates[1].temperature, 18);
  assert.equal(monthly.candidates[1].precipitation, 80);
  assert.equal(monthly.candidates[1].storage, 30);
  assert.equal(monthly.candidates[1].baseflow, 5);
  assert.equal(monthly.sources[1].ceiling, 14);
  assert.equal(monthly.sources[1].reserve, 8);
  assert.deepEqual(monthly.sources[1].members, [3, 8]);
  assert.equal(monthly.sources[0].ceiling, null);
  const missing = projectComparison(world, [8], 11);
  assert.equal(missing.candidates[0].temperature, null);
  assert.equal(missing.candidates[0].storage, null);
  assert.equal(missing.sources[1].ceiling, null);
});
