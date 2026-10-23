import type { NaturalDetail } from './types';

export type RGB = readonly [number, number, number];

/** Validate once at the display boundary; older/invalid detail fails to Phase 1. */
export function validNaturalDetail(detail?: NaturalDetail): detail is NaturalDetail {
  if (!detail || detail.version !== 1 || !Number.isInteger(detail.columns) || !Number.isInteger(detail.rows)
    || detail.columns < 1 || detail.rows < 1 || detail.columns * detail.rows > 262144) return false;
  const n = detail.columns * detail.rows;
  return Array.isArray(detail.terrain) && detail.terrain.length === n
    && detail.terrain.every(v => Number.isInteger(v) && v >= 0 && v <= 11)
    && Array.isArray(detail.shade) && detail.shade.length === n
    && detail.shade.every(v => Number.isInteger(v) && v >= 0 && v <= 255);
}

/**
 * A shared categorical surface, not separately rounded province polygons.
 * Cubic B-spline category weights are nonnegative and sum to one. The fourth-
 * power blend gives a narrow soft boundary without a blanket Gaussian blur.
 * Never interpolate category IDs or change the source grid/classification.
 * Ocean and lake colours are excluded from land blending: authoritative lake
 * paths are drawn on top and the same natural coastline clips the whole image.
 */
export function terrainPixels(detail: NaturalDetail, palette: readonly RGB[], shaded: boolean, factor = 4): {
  width: number; height: number; pixels: Uint8ClampedArray;
} {
  if (!validNaturalDetail(detail) || !Number.isInteger(factor) || factor < 1 || factor > 4
    || palette.length < 12 || palette.some(rgb => rgb.length !== 3 || rgb.some(v => !Number.isFinite(v)))) {
    throw new Error('Invalid natural raster input');
  }
  const { columns, rows, terrain, shade } = detail;
  const width = columns * factor, height = rows * factor;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const dry = (t: number) => t >= 2 && t !== 10;
  const spline = (t: number) => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t * t + 4) / 6,
    (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6, t ** 3 / 6];
  const groups = new Float64Array(12);
  const xSamples = Array.from({ length: width }, (_, px) => {
    const x = clamp((px + 0.5) / factor - 0.5, columns - 1), x0 = Math.floor(x);
    return { x0, x1: Math.min(x0 + 1, columns - 1), fx: x - x0,
      indices: [-1, 0, 1, 2].map(d => clamp(x0 + d, columns - 1)), weights: spline(x - x0) };
  });
  for (let py = 0; py < height; py++) {
    const y = clamp((py + 0.5) / factor - 0.5, rows - 1), y0 = Math.floor(y), y1 = Math.min(y0 + 1, rows - 1), fy = y - y0;
    const ys = [-1, 0, 1, 2].map(d => clamp(y0 + d, rows - 1)), yw = spline(fy);
    for (let px = 0; px < width; px++) {
      const { x0, x1, fx, indices: xs, weights: xw } = xSamples[px];
      const ids = [y0 * columns + x0, y0 * columns + x1, y1 * columns + x0, y1 * columns + x1];
      const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
      // Combine equal categories before sharpening; there is only one owner
      // field, so adjacent classes cannot create cracks or double fill.
      groups.fill(0);
      for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) {
        const kind = terrain[ys[yy] * columns + xs[xx]];
        if (dry(kind)) groups[kind] += yw[yy] * xw[xx];
      }
      let light = 0, landWeight = 0;
      for (let k = 0; k < 4; k++) {
        if (!dry(terrain[ids[k]])) continue;
        light += weights[k] * shade[ids[k]] / 128;
        landWeight += weights[k];
      }
      let sum = 0, r = 0, g = 0, b = 0;
      for (let t = 2; t < 12; t++) {
        const w = groups[t] ** 4;
        sum += w; r += palette[t][0] * w; g += palette[t][1] * w; b += palette[t][2] * w;
      }
      if (!sum) { [r, g, b] = palette[2]; sum = 1; }
      const gain = shaded && landWeight > 0 ? light / landWeight : 1;
      const i = (py * width + px) * 4;
      pixels[i] = r / sum * gain; pixels[i + 1] = g / sum * gain;
      pixels[i + 2] = b / sum * gain; pixels[i + 3] = 255;
    }
  }
  return { width, height, pixels };
}
