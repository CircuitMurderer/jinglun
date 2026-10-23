import type { Cell, MapConfig, MapResponse } from './types';
import { isMessageKey, type MessageKey, type Params } from './i18n';

export class ApiError extends Error {
  constructor(public key: MessageKey, public params: Params = {}) { super(key); }
}

export async function generateMap(config: MapConfig): Promise<MapResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch('/api/maps/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config), signal: controller.signal,
    });
    let data;
    try { data = await response.json(); }
    catch { throw new ApiError(response.ok ? 'error.response' : 'error.network'); }
    if (!response.ok) {
      const code = data?.error?.code;
      throw new ApiError(typeof code === 'string' && isMessageKey(code) ? code : 'error.generation', data?.error?.params ?? {});
    }
    if (!data?.map || data.map.generator_version !== '0.7.0' || !Array.isArray(data.map.cells)
      || data.map.cells.length !== config.cell_count || !Array.isArray(data.map.edges)
      || !Number.isFinite(data.map.width) || !Number.isFinite(data.meta?.generation_ms)
      || !Array.isArray(data.map.environment?.layers) || !Array.isArray(data.map.environment?.rivers)
      || !Number.isFinite(data.map.environment?.scale?.water_unit_m3)
      || !Array.isArray(data.map.environment?.deposits) || !Array.isArray(data.map.environment?.geology_provinces)
      || !Array.isArray(data.map.environment?.water_sources)
      || !data.map.environment.water_sources.every((source: {months?: unknown[]}) => Array.isArray(source.months) && source.months.length === 12)
      || !data.map.environment.rivers.every((river: {monthly_flow?: unknown[]; monthly_flow_index?: unknown[]}) => river.monthly_flow?.length === 12 && river.monthly_flow_index?.length === 12)
      || !Array.isArray(data.map.environment?.basins)
      || !data.map.environment.basins.every((basin: {months?: unknown[]}) => Array.isArray(basin.months) && basin.months.length === 12)
      || !data.map.cells.every((cell: Cell) => Array.isArray(cell.climate?.months)
        && Number.isFinite(cell.construction?.buildable_fraction) && Number.isFinite(cell.soil_profile?.depth_cm)
        && Array.isArray(cell.minerals) && Array.isArray(cell.geology_provinces)
        && Array.isArray(cell.water_source_ids) && cell.groundwater?.months?.length === 12
        && Number.isFinite(cell.endorheic_land_fraction) && Array.isArray(cell.lake_ids)
        && cell.climate.months.length === 12 && cell.climate.months.every((month) =>
          month && Number.isFinite(month.temperature_c) && Number.isFinite(month.precipitation_mm)
          && Number.isFinite(month.snowmelt_mm) && Number.isFinite(month.runoff_mm))
        && Number.isFinite(cell.climate.growing_months) && Number.isFinite(cell.climate.rainfed_months))) {
      throw new ApiError('error.response');
    }
    return data as MapResponse;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) throw new ApiError('error.timeout');
    throw new ApiError('error.network');
  } finally { clearTimeout(timeout); }
}
