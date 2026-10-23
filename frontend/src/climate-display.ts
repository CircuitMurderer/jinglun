import type { Cell } from './types';

/** Sea-dominant cells use their marine samples; mixed land climate stays intact. */
export function temperatureValue(cell: Cell, month?: number): number {
  if (!cell.is_land && cell.ocean) {
    const months = cell.ocean.surface_temperature_c;
    return month === undefined ? months.reduce((sum, v) => sum + v, 0) / months.length : months[month];
  }
  return month === undefined ? cell.temperature_c : cell.climate.months[month].temperature_c;
}
