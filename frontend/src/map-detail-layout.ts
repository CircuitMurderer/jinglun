import type { Point, WorldMap } from './types';
import { screenTransform, type MapViewState } from './map-camera.ts';

export interface DetailLayout {
  scale: number;
  symbols: Array<{ position: Point; terrain: number }>;
  labels: Array<{ id: number; position: Point }>;
}

/** Screen-space density limits; symbols indicate terrain, never settlements. */
export function detailLayout(world: WorldMap, view: Readonly<MapViewState>): DetailLayout {
  const { scale, x, y } = screenTransform(view);
  const result: DetailLayout = { scale, symbols: [], labels: [] };
  if (!Number.isFinite(scale) || scale <= 0) return result;
  const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];
  const claim = (p: Point, w: number, h: number) => {
    const sx = p.x * scale + x, sy = p.y * scale + y;
    if (sx < w || sy < h || sx > view.viewportWidth - w || sy > view.viewportHeight - h) return false;
    if (occupied.some(b => Math.abs(b.x - sx) < (b.w + w) / 2 + 6 && Math.abs(b.y - sy) < (b.h + h) / 2 + 6)) return false;
    occupied.push({ x: sx, y: sy, w, h });
    return true;
  };
  // Real governance IDs, not invented place names or precise mining locations.
  if (scale >= 1.6) {
    const cells = world.cells.filter(c => c.land_fraction > 0.5 && c.area * scale * scale >= 1800)
      .sort((a, b) => Number(b.id === view.selectedId) - Number(a.id === view.selectedId) || b.area - a.area || a.id - b.id);
    for (const cell of cells) {
      const position = cell.construction.land_anchor ?? cell.centroid;
      if (claim(position, 40, 18)) result.labels.push({ id: cell.id, position });
      if (result.labels.length >= 32) break;
    }
  }
  const source = world.environment.natural_surface?.detail?.symbols ?? [];
  for (const symbol of source) {
    if (!Number.isFinite(symbol.position.x) || !Number.isFinite(symbol.position.y)) continue;
    if ((symbol.terrain === 7 && scale >= 0.85) || (symbol.terrain === 4 && scale >= 1.15)) {
      if (claim(symbol.position, 20, 17)) result.symbols.push(symbol);
    }
    if (result.symbols.length >= 160) break;
  }
  return result;
}
