import type { Point, WorldMap } from './types';

type River = WorldMap['environment']['rivers'][number];
/** Rust provides intensity; both backends use identical cartographic styling. */
export function riverAppearance(river: River, month?: number) {
  const intensity = month === undefined ? river.flow_index : river.monthly_flow_index[month];
  const flow = month === undefined ? river.annual_flow : river.monthly_flow[month];
  return { width: 0.55 + intensity / 100 * 1.25, alpha: 0.45 + intensity / 100 * 0.45, visible: flow > 1e-8 };
}
const key = (point: Point): string => `${point.x},${point.y}`;

/** Cartographic pruning only: retained rivers keep their exact Rust geometry. */
export function selectMainRivers(rivers: readonly River[], minimumLength: number): River[] {
  const paths = rivers.filter((river) => river.points.length >= 2);
  const starts = new Map(paths.map((river, index) => [key(river.points[0]), index]));
  const upstream: number[][] = paths.map(() => []);
  const downstream = paths.map((river) => river.outlet === 'junction'
    ? starts.get(key(river.points[river.points.length - 1])) : undefined);
  for (let i = 0; i < paths.length; ++i) {
    const next = downstream[i];
    if (next !== undefined) upstream[next].push(i);
  }
  const lengths = paths.map((river) => river.points.slice(1).reduce((sum, point, index) => {
    const previous = river.points[index];
    return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
  }, 0));
  const longest = lengths.slice();
  const primary = new Int32Array(paths.length).fill(-1);
  const remaining = upstream.map((parents) => parents.length);
  const queue = remaining.flatMap((count, index) => count === 0 ? [index] : []);
  // Longest source-to-junction distance, without relying on segment array order.
  for (let cursor = 0; cursor < queue.length; ++cursor) {
    const index = queue[cursor];
    const next = downstream[index];
    if (next === undefined) continue;
    const previous = primary[next];
    if (previous === -1 || longest[index] > longest[previous]
      || (longest[index] === longest[previous] && paths[index].id < paths[previous].id)) {
      primary[next] = index;
      longest[next] = lengths[next] + longest[index];
    }
    if (--remaining[next] === 0) queue.push(next);
  }
  // The Rust network is acyclic. Preserve input rather than lose lines if a
  // future incompatible snapshot violates that contract.
  if (queue.length !== paths.length) return paths;
  const keep = new Set<number>();
  const pending = paths.flatMap((_, index) => downstream[index] === undefined
    && longest[index] >= minimumLength ? [index] : []);
  while (pending.length) {
    const index = pending.pop()!;
    if (keep.has(index)) continue;
    keep.add(index);
    for (const parent of upstream[index]) {
      // Always keep the main stem, including short links between confluences.
      // Only side branches shorter than the map's detail threshold disappear.
      if (parent === primary[index] || longest[parent] >= minimumLength) pending.push(parent);
    }
  }
  return paths.filter((_, index) => keep.has(index));
}

export function displayRivers(world: WorldMap): River[] {
  const step = Math.max(world.width / world.environment.columns, world.height / world.environment.rows);
  return selectMainRivers(world.environment.rivers, step * 3);
}
