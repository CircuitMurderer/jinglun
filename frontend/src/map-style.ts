import type { Layer, Terrain, WorldMap } from './types';

export type MapStyle = 'classic' | 'natural';

/** Analytical layers remain cell aggregates. Older servers fail closed. */
export function effectiveMapStyle(style: MapStyle, layer: Layer, world?: WorldMap): MapStyle {
  return style === 'natural' && layer === 'terrain' && world?.environment.natural_surface?.version === 1
    ? 'natural' : 'classic';
}

/** Shared by the SVG main map and Canvas minimap; never alter source geometry. */
export function naturalTerrainPaints(world: WorldMap): Array<{ path: string; terrain: Terrain }> {
  return (world.environment.natural_surface?.terrain ?? []).flatMap((band) => {
    const terrain = world.environment.terrain_palette[band.terrain];
    return terrain && band.path ? [{ path: band.path, terrain }] : [];
  });
}

export function drawNaturalMinimap(context: CanvasRenderingContext2D, world: WorldMap, color: (terrain: Terrain) => string): void {
  const surface = world.environment.natural_surface;
  if (!surface || surface.version !== 1) return;
  context.fillStyle = color('deep_ocean');
  context.fillRect(0, 0, world.width, world.height);
  context.fillStyle = color('shallow_sea');
  context.fill(new Path2D(surface.shallow_path), 'evenodd');
  const land = new Path2D(surface.land_path);
  context.save();
  context.clip(land, 'evenodd');
  context.fillStyle = color('plains');
  context.fill(land, 'evenodd');
  for (const paint of naturalTerrainPaints(world)) {
    context.fillStyle = color(paint.terrain);
    context.fill(new Path2D(paint.path), 'evenodd');
  }
  context.restore();
}
