import assert from 'node:assert/strict';
import test from 'node:test';
import { temperatureValue } from '../frontend/src/climate-display.ts';

test('sea-dominant mixed cells show marine temperature without overwriting terrestrial climate', () => {
  const cell = { is_land: false, temperature_c: -5, climate: { months: [{ temperature_c: -10 }] },
    ocean: { surface_temperature_c: Array.from({ length: 12 }, (_, m) => 12 + m) } };
  assert.equal(temperatureValue(cell), 17.5);
  assert.equal(temperatureValue(cell, 0), 12);
  cell.is_land = true;
  assert.equal(temperatureValue(cell), -5);
  assert.equal(temperatureValue(cell, 0), -10);
  assert.equal(cell.climate.months[0].temperature_c, -10);
});
