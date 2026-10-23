import { Container, Graphics, WebGLRenderer } from 'pixi.js';
import { screenTransform, type MapViewState } from './map-camera';
import type { RiverRenderer } from './river-overlay';
import type { WorldMap } from './types';
import { displayRivers, riverAppearance } from './river-display';

/** Static, real river geometry. No ticker, particles or simulation clock. */
export async function createRiverRenderer(
  world: WorldMap,
  initialView: Readonly<MapViewState>,
  host: HTMLElement,
  onFailure: () => void,
): Promise<RiverRenderer> {
  const renderer = new WebGLRenderer();
  const riverNetwork = displayRivers(world);
  const scene = new Container({ eventMode: 'none', interactiveChildren: false });
  const rivers = new Graphics();
  const land = new Graphics();
  scene.addChild(rivers, land);
  let destroyed = false;
  let view = initialView;
  let strokeScale = 0;
  let month: number | undefined;
  let inView = true;
  let observer: IntersectionObserver | undefined;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'map-gpu-canvas';

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    observer?.disconnect();
    document.removeEventListener('visibilitychange', resume);
    canvas.removeEventListener('webglcontextlost', onFailure);
    scene.destroy({ children: true, context: true });
    // init() can fail halfway through creating the renderer's systems.
    try { renderer.destroy({ removeView: true, releaseGlobalResources: true }); }
    catch { canvas.remove(); }
  }

  function draw(): void {
    if (destroyed || document.hidden || !inView) return;
    const { scale, x, y } = screenTransform(view);
    const resolution = Math.min(2, view.pixelRatio);
    if (renderer.screen.width !== view.viewportWidth || renderer.screen.height !== view.viewportHeight
      || renderer.resolution !== resolution) {
      renderer.resize(view.viewportWidth, view.viewportHeight, resolution);
    }
    scene.position.set(x, y);
    scene.scale.set(scale);
    if (strokeScale !== scale) {
      strokeScale = scale;
      rivers.clear();
      for (const river of riverNetwork) {
        if (river.points.length < 2) continue;
        const appearance = riverAppearance(river, month);
        if (!appearance.visible) continue;
        rivers.moveTo(river.points[0].x, river.points[0].y);
        for (const point of river.points.slice(1)) rivers.lineTo(point.x, point.y);
        rivers.stroke({
          color: 0x5fd0ff, alpha: appearance.alpha,
          // Match SVG vector-effect="non-scaling-stroke" in CSS pixels.
          width: appearance.width / scale,
          cap: 'round', join: 'round',
        });
      }
    }
    renderer.render({ container: scene });
  }

  function resume(): void {
    try { draw(); } catch { onFailure(); }
  }

  try {
    await renderer.init({
      canvas, width: view.viewportWidth, height: view.viewportHeight,
      resolution: Math.min(2, view.pixelRatio), autoDensity: true,
      backgroundAlpha: 0, antialias: true, powerPreference: 'low-power',
      // Geometry lives until explicit teardown; no background GC scheduler.
      gcActive: false,
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
    });
    for (const cell of world.cells) {
      if (cell.is_land) land.poly(cell.polygon.flatMap((point) => [point.x, point.y])).fill(0xffffff);
    }
    rivers.mask = land;
    canvas.addEventListener('webglcontextlost', onFailure);
    document.addEventListener('visibilitychange', resume);
    observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (inView) resume();
    });
    observer.observe(host);
    draw();
    host.append(canvas);
    return {
      setView(next) { view = next; draw(); },
      setMonth(next) { if (month !== next) { month = next; strokeScale = 0; draw(); } },
      destroy,
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
