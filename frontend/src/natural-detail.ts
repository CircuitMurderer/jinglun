import type { Terrain, WorldMap } from './types';
import { terrainPixels, validNaturalDetail, type RGB } from './terrain-raster.ts';

interface Texture { canvas: HTMLCanvasElement; href: string }
// One world holds at most light/dark × shaded/unshaded variants. Weak keys allow
// regeneration to release old canvases and URLs without a global growing cache.
const cache = new WeakMap<WorldMap, Map<string, Texture | null>>();

export function naturalTexture(world: WorldMap, color: (terrain: Terrain) => string, shaded: boolean): Texture | undefined {
  const palette = world.environment.terrain_palette.map(color);
  const key = `${shaded}:${palette.join(',')}`;
  let textures = cache.get(world);
  if (!textures) { textures = new Map(); cache.set(world, textures); }
  if (textures.has(key)) return textures.get(key) ?? undefined;
  const detail = world.environment.natural_surface?.detail;
  if (!validNaturalDetail(detail)) { textures.set(key, null); return; }
  try {
    const rgb = palette.map((hex): RGB => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]);
    const raster = terrainPixels(detail, rgb, shaded);
    const canvas = document.createElement('canvas');
    canvas.width = raster.width; canvas.height = raster.height;
    const context = canvas.getContext('2d');
    if (!context) { textures.set(key, null); return; }
    const image = context.createImageData(raster.width, raster.height);
    image.data.set(raster.pixels);
    context.putImageData(image, 0, 0);
    const texture = { canvas, href: canvas.toDataURL('image/png') };
    textures.set(key, texture);
    return texture;
  } catch {
    // A blocked/unsupported Canvas path must not break the existing SVG map.
    textures.set(key, null);
    return;
  }
}
