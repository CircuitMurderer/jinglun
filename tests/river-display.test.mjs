import assert from 'node:assert/strict';
import test from 'node:test';
import { selectMainRivers } from '../frontend/src/river-display.ts';

function river(id, coords, outlet = 'junction') {
  return { id, points: coords.map(([x, y]) => ({ x, y })), outlet, flow_index: 50, basin_id: 0 };
}
const ids = (rivers) => rivers.map((r) => r.id).sort((a, b) => a - b);

test('prunes the screenshot comb of tiny tributaries without breaking the main stem', () => {
  const rivers = [
    river(70, [[140.625, 778.125], [134.375, 784.375], [134.375, 790.625]]),
    river(72, [[134.375, 790.625], [128.125, 796.875]]),
    river(73, [[146.875, 790.625], [140.625, 790.625], [134.375, 790.625]]),
    river(74, [[128.125, 796.875], [121.875, 803.125]], 'ocean'),
    river(75, [[140.625, 796.875], [134.375, 796.875], [128.125, 796.875]]),
    river(76, [[128.125, 803.125], [121.875, 803.125]], 'ocean'),
    river(77, [[134.375, 809.375], [128.125, 809.375], [121.875, 809.375]], 'ocean'),
  ];
  const before = structuredClone(rivers);
  const selected = selectMainRivers(rivers, 18.75);
  assert.deepEqual(ids(selected), [70, 72, 74]);
  assert.deepEqual(rivers, before);
  for (const path of selected) assert.equal(path, rivers.find((r) => r.id === path.id));
});

test('keeps long horizontal rivers; direction alone never removes geometry', () => {
  const rivers = [river(0, [[0, 0], [20, 0]], 'ocean'), river(1, [[0, 10], [2, 10]], 'ocean')];
  assert.deepEqual(ids(selectMainRivers(rivers, 10)), [0]);
});

test('keeps a long river split into short confluence links and significant tributaries', () => {
  const rivers = [
    river(0, [[0, 0], [4, 0]]),
    river(1, [[4, -1], [4, 0]]),
    river(2, [[4, 0], [8, 0]]),
    river(3, [[8, -1], [8, 0]]),
    river(4, [[8, 0], [12, 0]]),
    river(5, [[12, -10], [12, 0]]),
    river(6, [[12, 0], [16, 0]], 'lake'),
  ];
  const expected = [0, 2, 4, 5, 6];
  assert.deepEqual(ids(selectMainRivers(rivers, 10)), expected);
  assert.deepEqual(ids(selectMainRivers([...rivers].reverse(), 10)), expected);
});

test('handles empty data and does not traverse a malformed cyclic network', () => {
  assert.deepEqual(selectMainRivers([], 10), []);
  const cyclic = [river(0, [[0, 0], [1, 0]]), river(1, [[1, 0], [0, 0]])];
  assert.deepEqual(ids(selectMainRivers(cyclic, 10)), [0, 1]);
});
