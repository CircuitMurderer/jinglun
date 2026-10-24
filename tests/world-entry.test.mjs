import assert from 'node:assert/strict';
import test from 'node:test';
import { worldEntryReducer } from '../frontend/src/world-entry.ts';

const generated = { map: { config: { seed: '第一片世界' }, cells: [] }, meta: { generation_ms: 100 } };
const replacement = { map: { config: { seed: '第二片世界' }, cells: [] }, meta: { generation_ms: 120 } };

test('a world must be generated and confirmed before the first round begins', () => {
  const setup = { stage: 'setup' };
  assert.equal(worldEntryReducer(setup, { type: 'confirm' }), setup);
  const preview = worldEntryReducer(setup, { type: 'generated', result: generated });
  assert.equal(preview.stage, 'confirm');
  assert.equal(preview.result, generated);
  assert.equal(worldEntryReducer(preview, { type: 'generated', result: replacement }), preview);
  const started = worldEntryReducer(preview, { type: 'confirm' });
  assert.equal(started.stage, 'round');
  assert.deepEqual(started.round, { year: 1, month: 1 });
  assert.equal(started.result, generated);
});

test('regenerate returns to configuration and keeps the preview until another generation succeeds', () => {
  const setup = worldEntryReducer({ stage: 'confirm', result: generated }, { type: 'configure' });
  assert.equal(setup.stage, 'setup');
  assert.equal(setup.result, generated);
  const preview = worldEntryReducer(setup, { type: 'generated', result: replacement });
  assert.equal(preview.stage, 'confirm');
  assert.equal(preview.result, replacement);
});

test('a started round cannot regenerate, rewind the entry or reset its date through entry actions', () => {
  const started = { stage: 'round', result: generated, round: { year: 2, month: 7 } };
  for (const action of [{ type: 'configure' }, { type: 'confirm' }, { type: 'generated', result: replacement }]) {
    assert.equal(worldEntryReducer(started, action), started);
  }
  assert.equal(started.result, generated);
  assert.deepEqual(started.round, { year: 2, month: 7 });
});

test('next round advances exactly one month, rolls the year at December and keeps the same world', () => {
  let state = { stage: 'round', result: generated, round: { year: 1, month: 1 } };
  for (let elapsed = 1; elapsed <= 25; elapsed++) {
    state = worldEntryReducer(state, { type: 'next-round' });
    assert.equal(state.round.year, 1 + Math.floor(elapsed / 12));
    assert.equal(state.round.month, 1 + elapsed % 12);
    assert.equal(state.result, generated);
  }
});

test('the calendar cannot advance during setup or map confirmation', () => {
  for (const state of [{ stage: 'setup' }, { stage: 'confirm', result: generated }]) {
    assert.equal(worldEntryReducer(state, { type: 'next-round' }), state);
  }
});
