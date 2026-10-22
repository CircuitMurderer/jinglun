import type { Cell, Layer, Point, ResourceKind, Terrain, WorldMap } from './types';
import { t } from './i18n';

export const terrainColors: Record<Terrain, string> = {
  deep_ocean: '#c2d3d8', shallow_sea: '#d2e2df', plains: '#c6c799', grassland: '#a7bb83',
  forest: '#749b77', desert: '#dfc998', hills: '#afa986', mountains: '#96988c', snow: '#e9e9dc',
  plateau: '#b4b08e', lake: '#88b6c3',
};
const NS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}
function interpolate(a: string, b: string, value: number): string {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const aa = rgb(a), bb = rgb(b);
  const ratio = Math.max(0, Math.min(1, value));
  return `rgb(${aa.map((v, i) => Math.round(v + (bb[i] - v) * ratio)).join(',')})`;
}
function fill(cell: Cell, layer: Layer, resource: ResourceKind): string {
  if (layer === 'terrain') return terrainColors[cell.terrain];
  if (layer === 'elevation') {
    if (!cell.is_land) return interpolate('#6d929f', '#d9e7e2', (cell.elevation_m + 4040) / 4040);
    if (cell.elevation_m < 1100) return interpolate('#b9cd9e', '#c5b78d', cell.elevation_m / 1100);
    return interpolate('#b3a180', '#f3f0e5', (cell.elevation_m - 1100) / 2500);
  }
  if (!cell.is_land) return terrainColors[cell.terrain];
  if (cell.terrain === 'lake') return terrainColors.lake;
  if (layer === 'rainfall') return interpolate('#e4d7b6', '#367d80', cell.rainfall_mm / 2400);
  if (layer === 'water') return interpolate('#dfc998', '#548d9e', cell.aridity_index / 1.5);
  if (layer === 'soil') return interpolate('#e8dcc7', '#926b46', cell.soil_quality / 100);
  if (layer === 'agriculture') return interpolate('#e9dfc4', '#50865b', cell.agricultural_suitability / 100);
  return interpolate('#e8e5d6', '#9f6544', (cell.resources.find((r) => r.kind === resource)?.potential ?? 0) / 70);
}
function points(polygon: Point[]): string { return polygon.map((p) => `${p.x},${p.y}`).join(' '); }

export class MapView {
  readonly element: SVGSVGElement;
  private world?: WorldMap;
  private scene = svg('g');
  private polygons = svg('g');
  private borders = svg('g');
  private symbols = svg('g', { 'pointer-events': 'none' });
  private coastline = svg('g', { 'pointer-events': 'none' });
  private selection = svg('g', { 'pointer-events': 'none' });
  private centers = svg('g', { 'pointer-events': 'none', display: 'none' });
  private water = svg('g', { 'pointer-events': 'none', class: 'water-network', 'clip-path': 'url(#river-land-clip)', display: 'none' });
  private riverClip = svg('clipPath', { id: 'river-land-clip', clipPathUnits: 'userSpaceOnUse' });
  private paths: SVGPolygonElement[] = [];
  private selected?: number;
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private drag?: { x: number; y: number; tx: number; ty: number; moved: boolean; pointerId: number };
  private suppressClick = false;
  onSelect: (cell: Cell) => void = () => {};
  onZoom: (scale: number) => void = () => {};

  constructor(container: HTMLElement) {
    this.element = svg('svg', { viewBox: '0 0 1600 1000', role: 'img', 'aria-label': t('map.accessible') });
    this.element.classList.add('world-svg');
    this.borders.setAttribute('pointer-events', 'none');
    const definitions = svg('defs');
    definitions.append(this.riverClip);
    this.scene.append(definitions, this.polygons, this.symbols, this.borders, this.coastline, this.water, this.centers, this.selection);
    this.element.append(this.scene);
    container.append(this.element);
    this.element.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.zoomAt(Math.exp(-event.deltaY * 0.0015), this.local(event.clientX, event.clientY));
    }, { passive: false });
    this.element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.drag = { x: event.clientX, y: event.clientY, tx: this.tx, ty: this.ty, moved: false, pointerId: event.pointerId };
      // Capture only after a drag starts, preserving normal polygon clicks.
    });
    this.element.addEventListener('pointermove', (event) => {
      if (!this.drag) return;
      const start = this.local(this.drag.x, this.drag.y);
      const current = this.local(event.clientX, event.clientY);
      if (Math.hypot(event.clientX - this.drag.x, event.clientY - this.drag.y) > 4) {
        this.drag.moved = true;
        if (!this.element.hasPointerCapture(event.pointerId)) this.element.setPointerCapture(event.pointerId);
      }
      if (this.drag.moved) {
        this.tx = this.drag.tx + current.x - start.x;
        this.ty = this.drag.ty + current.y - start.y;
        this.transform();
      }
    });
    const endDrag = () => {
      if (!this.drag) return;
      this.suppressClick = this.drag.moved;
      if (this.element.hasPointerCapture(this.drag.pointerId)) this.element.releasePointerCapture(this.drag.pointerId);
      this.drag = undefined;
      setTimeout(() => { this.suppressClick = false; }, 0);
    };
    this.element.addEventListener('pointerup', endDrag);
    this.element.addEventListener('pointercancel', endDrag);
    this.element.addEventListener('click', (event) => {
      if (this.suppressClick || !this.world || !(event.target instanceof SVGElement)) return;
      const id = event.target.dataset.cell;
      if (id !== undefined) this.select(Number(id));
    });
  }

  private local(x: number, y: number): DOMPoint {
    const matrix = this.element.getScreenCTM();
    return matrix ? new DOMPoint(x, y).matrixTransform(matrix.inverse()) : new DOMPoint(x, y);
  }
  private transform(): void {
    // Keep at least part of the world in frame; reset always restores full view.
    this.tx = Math.max(-1600 * this.scale + 180, Math.min(1420, this.tx));
    this.ty = Math.max(-1000 * this.scale + 120, Math.min(880, this.ty));
    this.scene.setAttribute('transform', `translate(${this.tx} ${this.ty}) scale(${this.scale})`);
    this.onZoom(this.scale);
  }
  private zoomAt(factor: number, p: Point): void {
    const next = Math.max(0.75, Math.min(7, this.scale * factor));
    const ratio = next / this.scale;
    this.tx = p.x - (p.x - this.tx) * ratio;
    this.ty = p.y - (p.y - this.ty) * ratio;
    this.scale = next;
    this.transform();
  }
  zoom(factor: number): void { this.zoomAt(factor, { x: 800, y: 500 }); }
  reset(): void { this.scale = 1; this.tx = 0; this.ty = 0; this.transform(); }

  setWorld(world: WorldMap): void {
    this.world = world;
    this.selected = undefined;
    this.paths = [];
    for (const group of [this.polygons, this.borders, this.symbols, this.coastline, this.water, this.riverClip, this.centers, this.selection]) group.replaceChildren();
    for (const cell of world.cells) {
      const polygon = svg('polygon', { points: points(cell.polygon), fill: terrainColors[cell.terrain], 'data-cell': String(cell.id) });
      polygon.append(svg('title'));
      polygon.querySelector('title')!.textContent = `${t('inspector.cell', { value: cell.id + 1 })} · ${t(`terrain.${cell.terrain}`)}`;
      this.paths.push(polygon);
      this.polygons.append(polygon);
      if (cell.is_land) this.riverClip.append(svg('polygon', { points: points(cell.polygon) }));
      this.centers.append(svg('circle', { cx: String(cell.site.x), cy: String(cell.site.y), r: '2.3', fill: '#3e5144', opacity: '0.65' }));
      if (cell.landform === 'mountains' && cell.land_fraction > 0.5) {
        const { x, y } = cell.centroid;
        this.symbols.append(svg('path', { d: `M${x - 7},${y + 4} l7,-12 l7,12 M${x - 2},${y - 5} l3,2 l2,-2`, fill: 'none', stroke: '#59645c', 'stroke-width': '1.3', opacity: '0.55' }));
      }
    }
    for (const edge of world.edges) {
      const d = `M${edge.start.x},${edge.start.y} L${edge.end.x},${edge.end.y}`;
      this.borders.append(svg('path', { d, stroke: edge.kind === 'sea' ? '#84a0aa' : '#62735b', opacity: edge.kind === 'sea' ? '0.13' : '0.3', 'stroke-width': '0.8', fill: 'none' }));
      if (edge.kind === 'coast') this.coastline.append(svg('path', { d, stroke: '#6b8579', 'stroke-width': '1.5', opacity: '0.75', fill: 'none' }));
    }
    // Rivers remain an optional line overlay; lake areas use the cell's dominant terrain.
    for (const river of world.environment.rivers) {
      this.water.append(svg('path', {
        d: river.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' '),
        fill: 'none', stroke: '#548fa6', 'stroke-opacity': '0.85', 'stroke-width': String(0.55 + river.flow_index / 100 * 1.25),
        'vector-effect': 'non-scaling-stroke',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'data-river': String(river.id),
      }));
    }
    this.reset();
  }

  setLayer(layer: Layer, resource: ResourceKind): void {
    if (!this.world) return;
    for (const cell of this.world.cells) this.paths[cell.id].setAttribute('fill', fill(cell, layer, resource));
    this.symbols.setAttribute('display', layer === 'terrain' ? '' : 'none');
  }
  showBorders(show: boolean): void { this.borders.setAttribute('display', show ? '' : 'none'); }
  showCenters(show: boolean): void { this.centers.setAttribute('display', show ? '' : 'none'); }
  showWater(show: boolean): void { this.water.setAttribute('display', show ? '' : 'none'); }

  select(id: number): void {
    const cell = this.world?.cells[id];
    if (!cell) return;
    this.selected = id;
    this.selection.replaceChildren();
    for (const n of cell.neighbors) {
      this.selection.append(svg('polygon', { points: points(this.world!.cells[n].polygon), fill: '#ffffff', 'fill-opacity': '0.1', stroke: '#f5eed2', 'stroke-width': '1.8', 'stroke-dasharray': '4 3' }));
    }
    this.selection.append(svg('polygon', { points: points(cell.polygon), fill: '#fff7d2', 'fill-opacity': '0.22', stroke: '#fff9d9', 'stroke-width': '4' }));
    this.selection.append(svg('polygon', { points: points(cell.polygon), fill: 'none', stroke: '#364b3e', 'stroke-width': '1.5' }));
    this.onSelect(cell);
  }

  get selectedId(): number | undefined { return this.selected; }
}
