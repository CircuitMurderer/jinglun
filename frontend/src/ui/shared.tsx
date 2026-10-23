import { useEffect, useRef, useState } from 'react';
import type { Cell, Layer, MapConfig, ResourceKind } from '../types';
import type { MessageKey } from '../i18n';
import type { IconName } from './Icon';

export const resources: ResourceKind[] = ['grain', 'livestock', 'fiber', 'timber', 'stone', 'coal', 'iron', 'oil', 'rare_earth', 'freshwater'];
export const layers: Array<{ id: Layer; icon: IconName }> = [
  { id: 'terrain', icon: 'mountain' }, { id: 'elevation', icon: 'layers' },
  { id: 'temperature', icon: 'temperature' }, { id: 'rainfall', icon: 'rain' },
  { id: 'water', icon: 'drop' }, { id: 'soil', icon: 'soil' },
  { id: 'agriculture', icon: 'wheat' }, { id: 'resources', icon: 'diamond' },
  { id: 'geology', icon: 'layers' }, { id: 'construction', icon: 'target' },
];
export const isClimateLayer = (layer: Layer) => layer === 'temperature' || layer === 'rainfall' || layer === 'water';

export function locationKey(cell: Cell): MessageKey {
  return cell.land_fraction > 0 && cell.land_fraction < 1 ? 'inspector.mixed'
    : cell.is_land ? (cell.is_coastal ? 'inspector.coastal' : 'inspector.inland') : 'inspector.sea';
}

export function initialCell(cells: Cell[]): Cell {
  return cells.find((cell) => cell.is_land && cell.river_access > 15 && cell.agricultural_suitability > 25)
    ?? cells.find((cell) => cell.is_land) ?? cells[0];
}

export const STORAGE_KEY = 'jinglun.map-settings.v1';
export function loadConfig(defaultSeed: string): MapConfig {
  const config: MapConfig = { seed: defaultSeed, cell_count: 500, relaxations: 2, land_ratio: 0.45 };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<MapConfig> | null;
    if (saved && typeof saved.seed === 'string' && saved.seed.trim() && Array.from(saved.seed).length <= 64) config.seed = saved.seed;
    if (saved && typeof saved.cell_count === 'number' && saved.cell_count >= 100 && saved.cell_count <= 2000) config.cell_count = saved.cell_count;
    if (saved && typeof saved.relaxations === 'number' && [0, 1, 2, 3].includes(saved.relaxations)) config.relaxations = saved.relaxations;
    if (saved && typeof saved.land_ratio === 'number' && saved.land_ratio >= 0.2 && saved.land_ratio <= 0.8) config.land_ratio = saved.land_ratio;
  } catch { /* Storage is optional; the map does not depend on it. */ }
  return config;
}
export function saveConfig(config: MapConfig): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch { /* Optional. */ }
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Eased count-up towards the latest value. */
export function useAnimatedNumber(value: number, duration = 700): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const current = useRef(value);
  useEffect(() => {
    if (!Number.isFinite(value) || reduced()) { current.current = value; setShown(value); return; }
    from.current = current.current;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - k) ** 3;
      current.current = from.current + (value - from.current) * eased;
      setShown(current.current);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return shown;
}

export function AnimatedNumber({ value, format }: { value: number; format: (value: number) => string }) {
  return <>{format(useAnimatedNumber(value))}</>;
}
