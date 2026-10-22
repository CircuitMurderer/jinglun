import type { MapConfig, MapResponse } from './types';
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
    if (!data?.map || data.map.generator_version !== '0.2.1' || !Array.isArray(data.map.cells)
      || data.map.cells.length !== config.cell_count || !Array.isArray(data.map.edges)
      || !Number.isFinite(data.map.width) || !Number.isFinite(data.meta?.generation_ms)
      || !Array.isArray(data.map.environment?.layers) || !Array.isArray(data.map.environment?.rivers)) {
      throw new ApiError('error.response');
    }
    return data as MapResponse;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) throw new ApiError('error.timeout');
    throw new ApiError('error.network');
  } finally { clearTimeout(timeout); }
}
