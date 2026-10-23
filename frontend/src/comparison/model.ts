import type { WorldMap } from '../types.ts';

export interface PinState { ids: readonly number[]; feedback: 'added' | 'duplicate' | 'limit' | null }
export type PinAction = { type: 'pin'; id: number } | { type: 'remove'; id: number } | { type: 'clear' };
export const initialPins: PinState = { ids: [], feedback: null };
export function reducePins(state: PinState, action: PinAction): PinState {
  if (action.type === 'clear') return initialPins;
  if (action.type === 'remove') return { ids: state.ids.filter(id => id !== action.id), feedback: null };
  if (state.ids.includes(action.id)) return { ...state, feedback: 'duplicate' };
  if (state.ids.length >= 4) return { ...state, feedback: 'limit' };
  return { ids: [...state.ids, action.id], feedback: 'added' };
}
function period<T>(months: readonly T[], month?: number): readonly T[] {
  return month === undefined ? months : months[month] === undefined ? [] : [months[month]];
}
function sum<T>(values: readonly T[], read: (value: T) => number): number | null {
  return values.length ? values.reduce((total, value) => total + read(value), 0) : null;
}
export function projectComparison(world: WorldMap, ids: readonly number[], month?: number) {
  const candidates = ids.flatMap(id => {
    const cell = world.cells.find(cell => cell.id === id);
    if (!cell) return [];
    const ground = period(cell.groundwater.months, month);
    const storage = sum(ground, value => value.storage_mm);
    return [{ cell, temperature: month === undefined ? cell.temperature_c : cell.climate.months[month]?.temperature_c ?? null,
      precipitation: month === undefined ? cell.rainfall_mm : cell.climate.months[month]?.precipitation_mm ?? null,
      storage: cell.land_fraction > 0 && storage !== null ? storage / ground.length : null,
      baseflow: cell.land_fraction > 0 ? sum(ground, value => value.baseflow_mm) : null }];
  });
  const sources = world.environment.water_sources.flatMap((source, index) => {
    const members = candidates.filter(({ cell }) => cell.water_source_ids.includes(source.id)).map(({ cell }) => cell.id);
    if (!members.length) return [];
    const months = period(source.months, month);
    const convert = (value: number | null) => value === null ? null : value * world.environment.scale.water_unit_m3 / 1_000_000;
    return [{ id: source.id, number: index + 1, members, outlet: source.outlet,
      ceiling: convert(sum(months, value => value.freshwater_ceiling)),
      reserve: convert(sum(months, value => value.ecological_reserve)),
      qualities: [...new Set(months.map(value => value.quality))] }];
  });
  return { candidates, sources };
}
