import type { Cell, GeologyKind, Layer, Point, ResourceKind, Terrain, WorldMap } from './types';
import { t } from './i18n';
import { MapCamera, screenTransform } from './map-camera';
import { RiverOverlay } from './river-overlay';
import { displayRivers, riverAppearance } from './river-display';
import { getThemeSnapshot } from './theme';

/** Base night-atlas palette. Daylight colors keep the same terrain categories. */
export const terrainColors: Record<Terrain, string> = {
  deep_ocean: '#0a1c2e', shallow_sea: '#123349', plains: '#9aa35f', grassland: '#6e9a52',
  forest: '#3d7550', desert: '#cfae6c', hills: '#a08c62', mountains: '#7e7c79', snow: '#e4ebef',
  plateau: '#ad9568', lake: '#2b8db5', tundra: '#8ea69c',
};

const lightTerrainColors: Record<Terrain, string> = {
  deep_ocean: '#afcbd8', shallow_sea: '#c9dfe1', plains: '#d6dba0', grassland: '#b5d399',
  forest: '#81b58d', desert: '#f1d9a4', hills: '#d4c5a3', mountains: '#b1b4b1', snow: '#f6f7f2',
  plateau: '#ddc49a', lake: '#79bdd3', tundra: '#c7d9cd',
};

export function terrainColor(terrain: Terrain): string {
  return (getThemeSnapshot().resolved === 'light' ? lightTerrainColors : terrainColors)[terrain];
}

export const geologyColors = { sedimentary: '#aa9266', craton: '#8271ac', orogenic: '#a2685a', igneous: '#557f88' };
const lightGeologyColors = { sedimentary: '#e6d3a4', craton: '#c5b8df', orogenic: '#dfafa1', igneous: '#9cc8c5' };
export function geologyColor(kind: GeologyKind): string {
  return kind === 'ocean' ? terrainColor('deep_ocean') : (getThemeSnapshot().resolved === 'light' ? lightGeologyColors : geologyColors)[kind];
}

type Ramp = ReadonlyArray<readonly [number, string]>;
export const ramps = {
  elevationSea: [[0, '#050f1c'], [1, '#1d4c69']],
  elevationLand: [[0, '#2f6b4f'], [0.3, '#8fa35a'], [0.55, '#c2a46a'], [0.8, '#9c8672'], [1, '#f4f1ea']],
  temperature: [[0, '#2b4fd6'], [0.36, '#6ec6e8'], [0.5, '#efe9cf'], [0.7, '#f6b44f'], [1, '#d8343f']],
  rainfall: [[0, '#5b4423'], [0.35, '#a89048'], [0.65, '#3aa58a'], [1, '#39b6f0']],
  water: [[0, '#7a3f1d'], [0.4, '#c9a35f'], [0.7, '#3ba39a'], [1, '#2f86e0']],
  soil: [[0, '#2d2620'], [0.5, '#8d6a42'], [1, '#f0c178']],
  agriculture: [[0, '#26302a'], [0.5, '#4f8f3c'], [1, '#d4f57c']],
  resources: [[0, '#1c2236'], [0.35, '#5b3fc4'], [0.7, '#e0559f'], [1, '#ffd27a']],
  construction: [[0, '#4c3947'], [0.4, '#8f795c'], [0.7, '#4c9a85'], [1, '#abdfbc']],
} satisfies Record<string, Ramp>;

const lightRamps = {
  elevationSea: [[0, '#89afc2'], [1, '#d6e8e7']],
  elevationLand: [[0, '#bdd7af'], [0.3, '#d4dba7'], [0.55, '#e3cea5'], [0.8, '#c5beb2'], [1, '#f7f6ee']],
  temperature: [[0, '#879cdd'], [0.36, '#b1dde7'], [0.5, '#f2ebd9'], [0.7, '#edbd7b'], [1, '#d57070']],
  rainfall: [[0, '#efe0bd'], [0.35, '#cbd69c'], [0.65, '#78bfba'], [1, '#58a6d6']],
  water: [[0, '#f1d2ad'], [0.4, '#d7d9a7'], [0.7, '#8ccdc8'], [1, '#68afd4']],
  soil: [[0, '#f0e7d7'], [0.5, '#d3b68f'], [1, '#a97e50']],
  agriculture: [[0, '#e4e7d7'], [0.5, '#a8cb8b'], [1, '#5c985c']],
  resources: [[0, '#e8e5f0'], [0.35, '#b9a4e2'], [0.7, '#dd9cbb'], [1, '#efc982']],
  construction: [[0, '#e3d5dd'], [0.4, '#e6d6b5'], [0.7, '#acd3bd'], [1, '#599e84']],
} satisfies Record<keyof typeof ramps, Ramp>;

function colorRamp(kind: keyof typeof ramps): Ramp {
  return (getThemeSnapshot().resolved === 'light' ? lightRamps : ramps)[kind];
}

const rgbCache = new Map<string, number[]>();
function rgb(hex: string): number[] {
  let value = rgbCache.get(hex);
  if (!value) { value = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); rgbCache.set(hex, value); }
  return value;
}
export function sample(ramp: Ramp, value: number): string {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  let i = 1;
  while (i < ramp.length - 1 && v > ramp[i][0]) ++i;
  const [p0, c0] = ramp[i - 1];
  const [p1, c1] = ramp[i];
  const r = p1 === p0 ? 0 : (v - p0) / (p1 - p0);
  const a = rgb(c0), b = rgb(c1);
  return `rgb(${a.map((x, k) => Math.round(x + (b[k] - x) * r)).join(',')})`;
}
function css(ramp: Ramp, from = 0, to = 1): string {
  return ramp.map(([p, c]) => `${c} ${((from + p * (to - from)) * 100).toFixed(1)}%`).join(',');
}
/** CSS gradient that matches the fill function, for legends. */
export function legendGradient(layer: Exclude<Layer, 'terrain' | 'geology'>): string {
  if (layer === 'elevation') return `linear-gradient(90deg,${css(colorRamp('elevationSea'), 0, 0.5)},${css(colorRamp('elevationLand'), 0.5, 1)})`;
  return `linear-gradient(90deg,${css(colorRamp(layer))})`;
}

export function cellFill(cell: Cell, layer: Layer, resource: ResourceKind, month?: number): string {
  if (layer === 'terrain') return terrainColor(cell.terrain);
  if (layer === 'elevation') {
    if (!cell.is_land) return sample(colorRamp('elevationSea'), (cell.elevation_m + 4040) / 4040);
    return sample(colorRamp('elevationLand'), cell.elevation_m / 3600);
  }
  if (!cell.is_land) return terrainColor(cell.terrain);
  if (cell.terrain === 'lake') return terrainColor('lake');
  if (layer === 'geology') return geologyColor(cell.geology_kind);
  if (layer === 'construction') return sample(colorRamp('construction'), cell.construction.buildable_fraction + cell.construction.conditional_fraction * 0.4);
  if (layer === 'temperature') {
    const temperature = month === undefined ? cell.temperature_c : cell.climate.months[month].temperature_c;
    return sample(colorRamp('temperature'), (temperature + 30) / 70);
  }
  if (layer === 'rainfall') return sample(colorRamp('rainfall'), month === undefined
    ? cell.rainfall_mm / 2400 : cell.climate.months[month].precipitation_mm / 300);
  if (layer === 'water') return sample(colorRamp('water'), cell.aridity_index / 1.5);
  if (layer === 'soil') return sample(colorRamp('soil'), cell.soil_quality / 100);
  if (layer === 'agriculture') return sample(colorRamp('agriculture'), cell.agricultural_suitability / 100);
  return sample(colorRamp('resources'), (cell.resources.find((r) => r.kind === resource)?.potential ?? 0) / 70);
}

/** Latitude of a world y coordinate (north at the top). */
export function latitudeAt(world: WorldMap, y: number): number {
  const [south, north] = world.environment.latitude_range;
  return north - (y / world.height) * (north - south);
}

const NS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}
function points(polygon: Point[]): string { return polygon.map((p) => `${p.x},${p.y}`).join(' '); }
function hash(n: number): number { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

export class MapView {
  readonly element: SVGSVGElement;
  readonly camera = new MapCamera();
  private world?: WorldMap;
  private surface = document.createElement('div');
  private gpuHost = document.createElement('div');
  private labels = document.createElement('div');
  private foreground = svg('svg', { viewBox: '0 0 1600 1000', 'aria-hidden': 'true' });
  private foregroundScene = svg('g');
  private overlay: RiverOverlay;
  private observer: ResizeObserver;
  private events = new AbortController();
  private unsubscribe: () => void;
  private ratioQuery?: MediaQueryList;
  private waterVisible = false;
  private gpuActive = false;
  private month?: number;
  private layer: Layer = 'terrain';
  private resource: ResourceKind = 'iron';
  private scene = svg('g');
  private graticule = svg('g', { 'pointer-events': 'none', class: 'graticule' });
  private polygons = svg('g', { class: 'cells' });
  private borders = svg('g');
  private symbols = svg('g', { 'pointer-events': 'none', class: 'relief' });
  private coastline = svg('g', { 'pointer-events': 'none', class: 'coastline' });
  private selection = svg('g', { 'pointer-events': 'none', class: 'selection' });
  private hoverLayer = svg('g', { 'pointer-events': 'none', class: 'hover' });
  private centers = svg('g', { 'pointer-events': 'none', display: 'none' });
  private water = svg('g', { 'pointer-events': 'none', class: 'water-network', 'clip-path': 'url(#river-land-clip)', display: 'none' });
  private riverClip = svg('clipPath', { id: 'river-land-clip', clipPathUnits: 'userSpaceOnUse' });
  private paths: SVGPolygonElement[] = [];
  private riverPaths: Array<{ path: SVGPathElement; river: WorldMap['environment']['rivers'][number] }> = [];
  private latitudeLabels: Array<{ y: number; element: HTMLSpanElement }> = [];
  private drag?: { x: number; y: number; tx: number; ty: number; moved: boolean; pointerId: number };
  private suppressClick = false;
  private hoverId?: number;
  private previewId?: number;
  private flight = 0;
  private lastRevealCell?: SVGPolygonElement;
  onSelect: (cell: Cell) => void = () => {};
  onZoom: (scale: number) => void = () => {};
  /** Pointer hover over a cell (undefined when leaving the map or dragging). */
  onHover: (cell: Cell | undefined, clientX: number, clientY: number) => void = () => {};
  /** World coordinate under the pointer, for the HUD readout. */
  onCursor: (point: Point | undefined) => void = () => {};

  constructor(container: HTMLElement) {
    this.element = svg('svg', { viewBox: '0 0 1600 1000', role: 'img', 'aria-label': t('map.accessible') });
    this.element.classList.add('world-svg');
    this.element.addEventListener('animationend', (event) => {
      if (event.animationName === 'cell-reveal' && event.target === this.lastRevealCell) {
        this.element.classList.remove('revealing');
        this.lastRevealCell = undefined;
      }
    }, { signal: this.events.signal });
    this.surface.className = 'map-surface';
    this.gpuHost.className = 'map-gpu-layer';
    this.labels.className = 'map-graticule-labels';
    this.labels.setAttribute('aria-hidden', 'true');
    this.foreground.classList.add('map-selection-svg');
    this.borders.setAttribute('pointer-events', 'none');
    const definitions = svg('defs');
    definitions.append(this.riverClip);
    this.scene.append(definitions, this.polygons, this.symbols, this.borders, this.graticule, this.coastline, this.water);
    this.element.append(this.scene);
    this.foregroundScene.append(this.centers, this.hoverLayer, this.selection);
    this.foreground.append(this.foregroundScene);
    this.surface.append(this.element, this.gpuHost, this.foreground, this.labels);
    container.append(this.surface);
    this.overlay = new RiverOverlay(this.gpuHost, (status) => {
      this.gpuActive = status === 'gpu';
      this.updateWater();
    });
    this.unsubscribe = this.camera.subscribe((view) => {
      const transform = `translate(${view.tx} ${view.ty}) scale(${view.scale})`;
      this.scene.setAttribute('transform', transform);
      this.foregroundScene.setAttribute('transform', transform);
      this.overlay.setView(view);
      this.placeLabels();
      this.onZoom(view.scale);
    });
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(this.surface);
    window.addEventListener('resize', this.resize, { signal: this.events.signal });
    this.watchPixelRatio();
    const signal = this.events.signal;
    this.element.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.cancelFlight();
      this.camera.zoom(Math.exp(-event.deltaY * 0.0015), this.local(event.clientX, event.clientY));
    }, { passive: false, signal });
    this.element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.cancelFlight();
      const { tx, ty } = this.camera.state;
      this.drag = { x: event.clientX, y: event.clientY, tx, ty, moved: false, pointerId: event.pointerId };
      // Capture only after a drag starts, preserving normal polygon clicks.
    }, { signal });
    this.element.addEventListener('pointermove', (event) => {
      this.onCursor(this.worldPoint(event.clientX, event.clientY));
      if (!this.drag) {
        if (this.hoverId !== undefined && this.world) this.onHover(this.world.cells[this.hoverId], event.clientX, event.clientY);
        return;
      }
      const start = this.local(this.drag.x, this.drag.y);
      const current = this.local(event.clientX, event.clientY);
      if (Math.hypot(event.clientX - this.drag.x, event.clientY - this.drag.y) > 4) {
        if (!this.drag.moved) { this.setHover(undefined); this.element.classList.add('dragging'); }
        this.drag.moved = true;
        if (!this.element.hasPointerCapture(event.pointerId)) this.element.setPointerCapture(event.pointerId);
      }
      if (this.drag.moved) {
        this.camera.pan(this.drag.tx + current.x - start.x, this.drag.ty + current.y - start.y);
      }
    }, { signal });
    this.element.addEventListener('pointerover', (event) => {
      if (this.drag?.moved || !(event.target instanceof SVGElement)) return;
      const id = event.target.dataset.cell;
      if (id !== undefined) this.setHover(Number(id), event.clientX, event.clientY);
    }, { signal });
    this.element.addEventListener('pointerleave', () => {
      this.setHover(undefined);
      this.onCursor(undefined);
    }, { signal });
    const endDrag = () => {
      if (!this.drag) return;
      this.suppressClick = this.drag.moved;
      if (this.element.hasPointerCapture(this.drag.pointerId)) this.element.releasePointerCapture(this.drag.pointerId);
      this.drag = undefined;
      this.element.classList.remove('dragging');
      setTimeout(() => { this.suppressClick = false; }, 0);
    };
    this.element.addEventListener('pointerup', endDrag, { signal });
    this.element.addEventListener('pointercancel', endDrag, { signal });
    this.element.addEventListener('click', (event) => {
      if (this.suppressClick || !this.world || !(event.target instanceof SVGElement)) return;
      const id = event.target.dataset.cell;
      if (id !== undefined) this.select(Number(id));
    }, { signal });
  }

  private resize = (): void => {
    const rect = this.surface.getBoundingClientRect();
    this.camera.setViewport(rect.width, rect.height, window.devicePixelRatio || 1);
  };
  private watchPixelRatio = (): void => {
    this.ratioQuery?.removeEventListener('change', this.watchPixelRatio);
    this.ratioQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.ratioQuery.addEventListener('change', this.watchPixelRatio, { once: true, signal: this.events.signal });
    this.resize();
  };
  private local(x: number, y: number): Point {
    const rect = this.surface.getBoundingClientRect();
    return this.camera.toView({ x: x - rect.left, y: y - rect.top });
  }
  private worldPoint(x: number, y: number): Point | undefined {
    if (!this.world) return undefined;
    const rect = this.surface.getBoundingClientRect();
    const transform = screenTransform(this.camera.state);
    const point = { x: (x - rect.left - transform.x) / transform.scale, y: (y - rect.top - transform.y) / transform.scale };
    return point.x >= 0 && point.y >= 0 && point.x <= this.world.width && point.y <= this.world.height ? point : undefined;
  }
  zoom(factor: number): void { this.cancelFlight(); this.camera.zoom(factor); }
  reset(): void { this.cancelFlight(); this.camera.reset(); this.onZoom(this.camera.state.scale); }

  private cancelFlight(): void { if (this.flight) cancelAnimationFrame(this.flight); this.flight = 0; }
  /** Smoothly center a world point; scale defaults to the current zoom. */
  flyTo(point: Point, scale = this.camera.state.scale, duration = 750): void {
    this.cancelFlight();
    const from = { ...this.camera.state };
    const { viewportWidth, viewportHeight } = from;
    const center = this.camera.toView({ x: viewportWidth / 2, y: viewportHeight / 2 });
    const target = { scale, tx: center.x - point.x * scale, ty: center.y - point.y * scale };
    if (duration <= 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) { this.camera.setView(target.scale, target.tx, target.ty); return; }
    const start = performance.now();
    const step = (now: number) => {
      const k = ease(Math.min(1, (now - start) / duration));
      this.camera.setView(from.scale + (target.scale - from.scale) * k, from.tx + (target.tx - from.tx) * k, from.ty + (target.ty - from.ty) * k);
      this.flight = k < 1 ? requestAnimationFrame(step) : 0;
    };
    this.flight = requestAnimationFrame(step);
  }
  focus(id: number, zoomIn = true): void {
    const cell = this.world?.cells[id];
    if (!cell) return;
    this.select(id);
    this.flyTo(cell.centroid, zoomIn ? Math.max(this.camera.state.scale, 2.4) : this.camera.state.scale);
  }

  private placeLabels(): void {
    if (!this.world) return;
    const view = this.camera.state;
    const { scale, y } = screenTransform(view);
    for (const label of this.latitudeLabels) {
      const top = y + label.y * scale;
      label.element.style.transform = `translate3d(0, ${top.toFixed(1)}px, 0)`;
      label.element.hidden = top < 8 || top > view.viewportHeight - 8;
    }
  }

  setWorld(world: WorldMap): void {
    this.element.classList.remove('revealing');
    this.lastRevealCell = undefined;
    this.world = world;
    this.cancelFlight();
    this.hoverId = this.previewId = undefined;
    this.element.setAttribute('viewBox', `0 0 ${world.width} ${world.height}`);
    this.foreground.setAttribute('viewBox', `0 0 ${world.width} ${world.height}`);
    this.overlay.setWorld(world);
    this.camera.setWorld(world.width, world.height);
    this.paths = [];
    this.riverPaths = [];
    for (const group of [this.polygons, this.borders, this.symbols, this.coastline, this.water, this.riverClip, this.centers, this.selection, this.hoverLayer, this.graticule]) group.replaceChildren();
    const cx = world.width / 2, cy = world.height / 2;
    const reach = Math.hypot(cx, cy);
    let lastDelay = -1;
    for (const cell of world.cells) {
      const delay = Math.round(Math.hypot(cell.centroid.x - cx, cell.centroid.y - cy) / reach * 1100 + hash(cell.id) * 220);
      const fill = cellFill(cell, this.layer, this.resource, this.month);
      const polygon = svg('polygon', {
        points: points(cell.polygon), fill,
        'data-cell': String(cell.id), class: cell.is_land ? 'cell land' : 'cell sea', style: `--d:${delay}ms;--cell-fill:${fill}`,
      });
      if (delay >= lastDelay) { lastDelay = delay; this.lastRevealCell = polygon; }
      this.paths.push(polygon);
      this.polygons.append(polygon);
      if (cell.is_land) this.riverClip.append(svg('polygon', { points: points(cell.polygon) }));
      this.centers.append(svg('circle', { cx: String(cell.site.x), cy: String(cell.site.y), r: '2.2', class: 'cell-center' }));
      if (cell.landform === 'mountains' && cell.land_fraction > 0.5) {
        const { x, y } = cell.centroid;
        this.symbols.append(svg('path', { d: `M${x - 7},${y + 4} l7,-12 l7,12 M${x - 2},${y - 5} l3,2 l2,-2` }));
      }
    }
    for (const edge of world.edges) {
      const d = `M${edge.start.x},${edge.start.y} L${edge.end.x},${edge.end.y}`;
      this.borders.append(svg('path', { d, class: `edge edge-${edge.kind}` }));
      if (edge.kind === 'coast') {
        this.coastline.append(svg('path', { d, class: 'coast-glow' }), svg('path', { d, class: 'coast-line' }));
      }
    }
    // Graticule: 经纬 — latitude every 15°, meridians every tenth of the width.
    this.labels.replaceChildren();
    this.latitudeLabels = [];
    const [south, north] = world.environment.latitude_range;
    for (let lat = Math.ceil(south / 15) * 15; lat <= north; lat += 15) {
      const y = (north - lat) / (north - south) * world.height;
      if (y <= 0 || y >= world.height) continue;
      this.graticule.append(svg('line', { x1: '0', x2: String(world.width), y1: String(y), y2: String(y), class: lat === 0 ? 'equator' : 'parallel' }));
      const element = document.createElement('span');
      element.className = lat === 0 ? 'lat-label equator' : 'lat-label';
      element.textContent = lat === 0 ? t('map.equator') : t(lat > 0 ? 'map.latN' : 'map.latS', { value: Math.abs(lat) });
      this.labels.append(element);
      this.latitudeLabels.push({ y, element });
    }
    for (let i = 1; i < 10; ++i) {
      const x = world.width * i / 10;
      this.graticule.append(svg('line', { x1: String(x), x2: String(x), y1: '0', y2: String(world.height), class: 'meridian' }));
    }
    // Rivers remain an optional line overlay; lake areas use the cell's dominant terrain.
    for (const river of displayRivers(world)) {
      const path = svg('path', {
        d: river.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' '),
        fill: 'none', stroke: '#5fd0ff', 'stroke-opacity': '0.9', 'stroke-width': String(0.55 + river.flow_index / 100 * 1.25),
        'vector-effect': 'non-scaling-stroke',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'data-river': String(river.id),
      });
      this.riverPaths.push({ path, river });
      this.water.append(path);
    }
    this.updateRivers();
    // Use the actual final animation end, not a wall-clock timeout that can cut
    // off the reveal when rendering is delayed or the tab is in the background.
    void this.element.getBoundingClientRect();
    if (this.lastRevealCell) this.element.classList.add('revealing');
    this.reset();
    this.placeLabels();
  }

  setLayer(layer: Layer, resource: ResourceKind): void {
    this.layer = layer;
    this.resource = resource;
    if (!this.world) return;
    for (const cell of this.world.cells) {
      const polygon = this.paths[cell.id];
      const fill = cellFill(cell, layer, resource, this.month);
      polygon.setAttribute('fill', fill);
      polygon.style.setProperty('--cell-fill', fill);
    }
    this.symbols.setAttribute('display', layer === 'terrain' ? '' : 'none');
  }
  setMonth(month?: number): void {
    this.month = month !== undefined && Number.isInteger(month) && month >= 0 && month < 12 ? month : undefined;
    this.setLayer(this.layer, this.resource);
    this.updateRivers();
  }
  private updateRivers(): void {
    for (const { path, river } of this.riverPaths) {
      const appearance = riverAppearance(river, this.month);
      path.setAttribute('stroke-width', String(appearance.width));
      path.setAttribute('stroke-opacity', String(appearance.alpha));
      path.setAttribute('display', appearance.visible ? '' : 'none');
    }
    this.overlay.setMonth(this.month);
  }
  showBorders(show: boolean): void { this.borders.setAttribute('display', show ? '' : 'none'); }
  showCenters(show: boolean): void { this.centers.setAttribute('display', show ? '' : 'none'); }
  showGraticule(show: boolean): void {
    this.graticule.setAttribute('display', show ? '' : 'none');
    this.labels.hidden = !show;
  }
  private updateWater(): void { this.water.setAttribute('display', this.waterVisible && !this.gpuActive ? '' : 'none'); }
  showWater(show: boolean): void {
    this.waterVisible = show;
    this.overlay.setVisible(show);
    this.updateWater();
  }

  private drawHover(): void {
    this.hoverLayer.replaceChildren();
    const id = this.previewId ?? this.hoverId;
    const cell = id === undefined ? undefined : this.world?.cells[id];
    if (!cell || id === this.selectedId) return;
    this.hoverLayer.append(svg('polygon', { points: points(cell.polygon), class: 'hover-fill' }));
  }
  private setHover(id: number | undefined, x = 0, y = 0): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.drawHover();
    this.onHover(id === undefined ? undefined : this.world?.cells[id], x, y);
  }
  /** Highlight a cell from outside the map (e.g. hovering a neighbour chip). */
  preview(id?: number): void {
    this.previewId = id;
    this.drawHover();
  }

  select(id: number): void {
    const cell = this.world?.cells[id];
    if (!cell) return;
    this.camera.select(id);
    this.selection.replaceChildren();
    for (const n of cell.neighbors) {
      this.selection.append(svg('polygon', { points: points(this.world!.cells[n].polygon), class: 'neighbor' }));
    }
    const shape = points(cell.polygon);
    this.selection.append(
      svg('polygon', { points: shape, class: 'selected-glow' }),
      svg('polygon', { points: shape, class: 'selected-fill' }),
      svg('polygon', { points: shape, class: 'selected-ants' }),
    );
    this.drawHover();
    this.onSelect(cell);
  }

  get selectedId(): number | undefined { return this.camera.state.selectedId; }

  destroy(): void {
    this.cancelFlight();
    this.events.abort();
    this.observer.disconnect();
    this.unsubscribe();
    this.overlay.destroy();
    this.surface.remove();
  }
}
