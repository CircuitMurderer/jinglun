import './style.css';
import { ApiError, generateMap } from './api';
import { getLocale, number, percent, t, type MessageKey } from './i18n';
import { MapView, terrainColors } from './map';
import type { Cell, Layer, MapConfig, MapResponse, ResourceKind, Terrain } from './types';

const icons = {
  mountain: '<path d="m3 18 6-12 5 8 3-5 4 9H3Z"/><path d="m7 10 2 2 2-2"/>',
  world: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
  layers: '<path d="m12 3 10 6-10 6L2 9l10-6ZM3 13l9 5 9-5M3 17l9 5 9-5"/>',
  arrow: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
  shuffle: '<path d="M3 6h3c5 0 7 12 12 12h3M3 18h3c5 0 7-12 12-12h3m-4-3 4 3-4 3m0 6 4 3-4 3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="3"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  leaf: '<path d="M20 3C5 3 2 9 6 16s16 1 14-13ZM5 20 16 8"/>',
  drop: '<path d="M12 3S5 11 5 15a7 7 0 0 0 14 0c0-4-7-12-7-12Z"/>',
  diamond: '<path d="m7 4-5 6 10 11 10-11-5-6H7Zm-5 6h20M7 4l5 17 5-17"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
};
function icon(name: keyof typeof icons, cls = ''): string {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}
function escape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
const resources: ResourceKind[] = ['grain', 'livestock', 'fiber', 'timber', 'stone', 'coal', 'iron', 'oil', 'rare_earth', 'freshwater'];
const layers: Layer[] = ['terrain', 'elevation', 'rainfall', 'water', 'soil', 'agriculture', 'resources'];
const layerIcons = ['mountain', 'layers', 'drop', 'drop', 'leaf', 'leaf', 'diamond'] as const;
const root = document.querySelector<HTMLDivElement>('#app')!;
document.title = t('app.title');
document.documentElement.lang = getLocale();

root.innerHTML = `
  <header class="app-header">
    <a class="brand" href="/" aria-label="${t('app.name')}"><span class="brand-mark">${icon('mountain')}</span><span class="brand-name">${t('app.name')}</span><span class="brand-tagline">${t('app.tagline')}</span></a>
    <nav class="header-nav" aria-label="${t('app.section')}"><span class="nav-current">${icon('world')}${t('app.section')}</span></nav>
    <div class="phase"><span class="status-dot"></span>${t('app.phase')}<span class="version-label">${t('app.version')}</span></div>
  </header>
  <main>
    <section class="intro"><div><p class="eyebrow">${t('world.eyebrow')}</p><h1>${t('world.title')}</h1></div><p class="intro-description">${t('world.description')}</p></section>
    <div class="workspace">
      <aside class="settings-panel panel">
        <section class="settings-section"><div class="section-heading"><span class="small-mark">01</span><h2>${t('settings.title')}</h2></div><p class="section-description">${t('settings.subtitle')}</p>
          <form id="generation-form">
            <label for="seed">${t('settings.seed')}</label><div class="seed-field"><input id="seed" name="seed" value="${escape(t('settings.defaultSeed'))}" maxlength="64" required placeholder="${t('settings.seedPlaceholder')}"/><button id="random-seed" class="icon-button" type="button" title="${t('settings.random')}" aria-label="${t('settings.random')}">${icon('shuffle')}</button></div>
            <div class="label-row"><label for="cell-count">${t('settings.count')}</label><output id="cell-count-output" for="cell-count"></output></div>
            <input id="cell-count" name="cell-count" type="range" min="100" max="2000" step="50" value="500"/>
            <div class="range-ends"><span>100</span><span>2,000</span></div>
            <label for="relaxations">${t('settings.relaxations')}</label><select id="relaxations" name="relaxations">${[0, 1, 2, 3].map((v) => `<option value="${v}"${v === 2 ? ' selected' : ''}>${t(`settings.relaxation.${v}` as 'settings.relaxation.0')}</option>`).join('')}</select>
            <div class="label-row land-label"><label for="land-ratio">${t('settings.land')}</label><output id="land-ratio-output" for="land-ratio"></output></div><input id="land-ratio" name="land-ratio" type="range" min="20" max="80" value="45"/>
            <p class="field-hint">${t('settings.landHint')}</p>
            <button id="generate" class="primary-button" type="submit"><span>${t('settings.generate')}</span>${icon('arrow')}</button>
          </form>
          <p class="settings-note">${t('settings.note')}</p>
        </section>
        <section class="layers-section"><div class="section-heading"><span class="small-mark">02</span><h2>${t('layers.title')}</h2></div>
          <div class="layer-list" role="group" aria-label="${t('layers.title')}">${layers.map((layer, i) => `<button class="layer-button${i === 0 ? ' active' : ''}" data-layer="${layer}" aria-pressed="${i === 0}">${icon(layerIcons[i])}<span>${t(`layer.${layer}`)}</span><span class="layer-dot"></span></button>`).join('')}</div>
          <div id="resource-picker" hidden><label for="resource">${t('layers.resource')}</label><select id="resource">${resources.map((r) => `<option value="${r}"${r === 'iron' ? ' selected' : ''}>${t(`resource.${r}`)}</option>`).join('')}</select></div>
          <div class="map-toggles"><label class="checkbox-label"><input type="checkbox" id="show-water"/><span>${t('layers.water')}</span></label><label class="checkbox-label"><input type="checkbox" id="show-borders" checked/><span>${t('layers.borders')}</span></label><label class="checkbox-label"><input type="checkbox" id="show-centers"/><span>${t('layers.centers')}</span></label></div>
        </section>
      </aside>
      <section class="map-panel panel">
        <div class="map-toolbar"><div class="map-heading">${icon('world')}<h2>${t('map.title')}</h2><span class="map-subtitle">${t('map.subtitle')}</span></div><button id="export" class="text-button" disabled>${icon('download')}<span>${t('map.export')}</span></button></div>
        <div class="map-canvas" id="map-canvas">
          <div class="coordinate-grid" aria-hidden="true"></div>
          <div class="map-compass" aria-hidden="true"><span>${t('map.north')}</span><svg width="26" height="44" viewBox="0 0 26 44"><path d="m13 3-8 25 8-6 8 6Z" fill="#50665c"/><path d="M13 3v19l8 6Z" fill="#93a49b"/><path d="M13 22v18" stroke="#50665c" stroke-width="1"/></svg></div>
          <div class="map-zoom"><button id="zoom-in" class="icon-button" title="${t('map.zoomIn')}" aria-label="${t('map.zoomIn')}">${icon('plus')}</button><button id="zoom-out" class="icon-button" title="${t('map.zoomOut')}" aria-label="${t('map.zoomOut')}">${icon('minus')}</button><span></span><button id="reset-view" class="icon-button" title="${t('map.reset')}" aria-label="${t('map.reset')}">${icon('fit')}</button></div>
          <div id="map-legend" class="map-legend"></div>
          <div id="map-overlay" class="map-overlay" aria-live="polite"><div class="loading-orbit">${icon('world')}</div><strong>${t('map.loading')}</strong><p>${t('map.loadingDetail')}</p></div>
          <div class="map-bottom-note"><span id="map-zoom-label"></span><span>${t('map.instructions')}</span></div>
        </div>
        <div class="map-footer"><span id="map-status"><span class="status-dot"></span>${t('map.noMap')}</span><span id="map-meta"></span></div>
      </section>
      <aside class="inspector-panel panel"><div class="inspector-heading"><div class="section-heading"><span class="small-mark">03</span><h2>${t('inspector.title')}</h2></div>${icon('pin')}</div><div class="cell-picker"><label for="cell-select">${t('inspector.choose')}</label><select id="cell-select" disabled></select></div><div id="inspector-content"></div></aside>
    </div>
    <section class="stats-grid" aria-live="polite" id="world-stats">${(['land', 'landmasses', 'coast', 'highlands', 'rivers', 'lakes'] as const).map((key, i) => `<article class="stat-card"><div class="stat-label">${icon((['world', 'layers', 'drop', 'mountain', 'drop', 'drop'] as const)[i])}${t(`stats.${key}`)}</div><strong id="stat-${key}">—</strong><p id="stat-note-${key}">—</p></article>`).join('')}</section>
    <footer class="page-footer"><span>${t('app.name')}<span class="footer-separator">/</span>${t('app.phase')}</span><span id="world-seed"></span></footer>
  </main>`;

function el<T extends HTMLElement>(selector: string): T { return document.querySelector<T>(selector)!; }
const seedInput = el<HTMLInputElement>('#seed');
const countInput = el<HTMLInputElement>('#cell-count');
const relaxInput = el<HTMLSelectElement>('#relaxations');
const landInput = el<HTMLInputElement>('#land-ratio');
const generateButton = el<HTMLButtonElement>('#generate');
const exportButton = el<HTMLButtonElement>('#export');
const cellSelect = el<HTMLSelectElement>('#cell-select');
const overlay = el<HTMLDivElement>('#map-overlay');
const inspector = el<HTMLDivElement>('#inspector-content');
const view = new MapView(el('#map-canvas'));
const STORAGE_KEY = 'jinglun.map-settings.v1';
let result: MapResponse | undefined;
let pending = false;
let layer: Layer = 'terrain';
let resource: ResourceKind = 'iron';

function updateOutputs(): void {
  el('#cell-count-output').textContent = t('settings.countValue', { value: number(Number(countInput.value)) });
  el('#land-ratio-output').textContent = percent(Number(landInput.value) / 100);
}
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<MapConfig> | null;
  if (saved && typeof saved.seed === 'string' && saved.seed.trim() && Array.from(saved.seed).length <= 64) seedInput.value = saved.seed;
  if (saved && typeof saved.cell_count === 'number' && saved.cell_count >= 100 && saved.cell_count <= 2000) countInput.value = String(saved.cell_count);
  if (saved && typeof saved.relaxations === 'number' && [0, 1, 2, 3].includes(saved.relaxations)) relaxInput.value = String(saved.relaxations);
  if (saved && typeof saved.land_ratio === 'number' && saved.land_ratio >= 0.2 && saved.land_ratio <= 0.8) landInput.value = String(saved.land_ratio * 100);
} catch { /* Storage is optional; the map does not depend on it. */ }
updateOutputs();
countInput.addEventListener('input', updateOutputs);
landInput.addEventListener('input', updateOutputs);
el('#random-seed').addEventListener('click', () => { seedInput.value = String(crypto.getRandomValues(new Uint32Array(1))[0]); });

function renderLegend(): void {
  let content = '';
  if (layer === 'terrain') {
    const shown: Terrain[] = ['deep_ocean', 'grassland', 'forest', 'desert', 'plateau', 'mountains', 'lake'];
    content = `<div class="terrain-legend">${shown.map((kind) => `<span><i style="background:${terrainColors[kind]}"></i>${t(`terrain.${kind}`)}</span>`).join('')}</div>`;
  } else {
    const ramps: Record<Exclude<Layer, 'terrain'>, string> = {
      elevation: '#6d929f,#d9e7e2,#b9cd9e,#c5b78d,#f3f0e5', rainfall: '#e4d7b6,#367d80',
      water: '#dfc998,#548d9e', soil: '#e8dcc7,#926b46', agriculture: '#e9dfc4,#50865b', resources: '#e8e5d6,#9f6544',
    };
    const labels: Record<Exclude<Layer, 'terrain'>, readonly [MessageKey, MessageKey]> = {
      elevation: ['legend.elevationMin', 'legend.elevationMax'], rainfall: ['legend.rainfallMin', 'legend.rainfallUpper'],
      water: ['legend.waterMin', 'legend.waterMax'], soil: ['legend.soilMin', 'legend.soilMax'],
      agriculture: ['legend.agricultureMin', 'legend.agricultureMax'], resources: ['legend.resourceMin', 'legend.resourceMax'],
    };
    const [low, high] = labels[layer];
    content = `<div class="gradient-legend"><strong>${layer === 'resources' ? t(`resource.${resource}`) : t(`layer.${layer}`)}</strong><div class="legend-ramp" style="background:linear-gradient(to right,${ramps[layer]})"></div><div class="legend-labels"><span>${t(low)}</span><span>${t(high)}</span></div></div>`;
  }
  el('#map-legend').innerHTML = content;
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-layer]')) {
  button.addEventListener('click', () => {
    layer = button.dataset.layer as Layer;
    for (const other of document.querySelectorAll('[data-layer]')) {
      other.classList.toggle('active', other === button);
      other.setAttribute('aria-pressed', String(other === button));
    }
    el('#resource-picker').hidden = layer !== 'resources';
    view.setLayer(layer, resource);
    renderLegend();
  });
}
el<HTMLSelectElement>('#resource').addEventListener('change', (event) => {
  resource = (event.target as HTMLSelectElement).value as ResourceKind;
  view.setLayer(layer, resource); renderLegend();
});
el<HTMLInputElement>('#show-borders').addEventListener('change', (event) => view.showBorders((event.target as HTMLInputElement).checked));
el<HTMLInputElement>('#show-water').addEventListener('change', (event) => view.showWater((event.target as HTMLInputElement).checked));
el<HTMLInputElement>('#show-centers').addEventListener('change', (event) => view.showCenters((event.target as HTMLInputElement).checked));
el('#zoom-in').addEventListener('click', () => view.zoom(1.3));
el('#zoom-out').addEventListener('click', () => view.zoom(1 / 1.3));
el('#reset-view').addEventListener('click', () => view.reset());
view.onZoom = (scale) => { el('#map-zoom-label').textContent = t('map.zoom', { value: percent(scale) }); };

function inspect(cell: Cell): void {
  if (!result) return;
  cellSelect.value = String(cell.id);
  const hasLand = cell.land_fraction > 0;
  const metric = (label: MessageKey, value: string) => `<div class="cell-metric"><span>${t(label)}</span><strong>${value}</strong></div>`;
  const bar = (label: MessageKey, value: number) => `<div class="index-label"><span>${t(label)}</span><strong>${number(value)}</strong></div><div class="index-bar"><span style="width:${value}%"></span></div>`;
  const location: MessageKey = cell.land_fraction > 0 && cell.land_fraction < 1 ? 'inspector.mixed'
    : cell.is_land ? (cell.is_coastal ? 'inspector.coastal' : 'inspector.inland') : 'inspector.sea';
  const terrestrial = hasLand ? `
    <section class="geo-composition"><h4>${t('inspector.components')}</h4><div class="geo-chips"><span>${t(`landform.${cell.landform}`)}</span><span>${t(`thermal.${cell.thermal_zone}`)} · ${t(`moisture.${cell.moisture_zone}`)}</span><span>${t(`vegetation.${cell.vegetation}`)}</span></div></section>
    <div class="land-indices">${bar('inspector.flatness', cell.flatness)}${bar('inspector.fertility', cell.soil_quality)}${bar('inspector.agriculture', cell.agricultural_suitability)}${bar('inspector.irrigation', cell.irrigation_potential)}<div class="index-label arable-label"><span>${t('inspector.arable')}</span><strong>${percent(cell.arable_fraction, 1)}</strong></div></div>
    <p class="inspector-note">${t('inspector.agricultureNote')}</p>
    <section class="geo-causes"><h4>${t('inspector.explanation')}</h4><ul>${cell.causes.map((cause) => `<li>${t(`cause.${cause}`)}</li>`).join('')}</ul></section>
    <div class="resource-heading"><h4>${t('inspector.resources')}</h4>${icon('leaf')}</div><div class="resource-list">${cell.resources.map((r) => `<div class="resource-row"><span>${t(`resource.${r.kind}`)}</span><div class="resource-track"><i style="width:${r.potential}%"></i></div><strong>${number(r.potential)}</strong></div>`).join('')}</div><p class="inspector-note">${t('inspector.resourcesNote')}</p>`
    : `<div class="sea-note">${icon('drop')}<p>${t('inspector.seaNote')}</p></div>`;
  inspector.innerHTML = `
    <div class="cell-hero"><span class="terrain-chip"><i style="background:${terrainColors[cell.terrain]}"></i>${t(`terrain.${cell.terrain}`)}</span><h3>${t('inspector.cell', { value: number(cell.id + 1) })}</h3><p>${t(location)}<span>·</span>${t('inspector.position', { x: number(cell.centroid.x), y: number(cell.centroid.y) })}</p></div>
    <div class="cell-metrics">${metric('inspector.elevation', t('unit.m', { value: number(cell.elevation_m) }))}${metric('inspector.rainfall', t('unit.mm', { value: number(cell.rainfall_mm) }))}${metric('inspector.temperature', t('unit.celsius', { value: number(cell.temperature_c, 1) }))}${metric('inspector.landFraction', percent(cell.land_fraction, 1))}${metric('inspector.landShare', percent(cell.area / (result.map.width * result.map.height), 2))}${metric('inspector.lakeFraction', percent(cell.lake_fraction, 1))}</div>
    ${hasLand ? `<p class="inspector-note means-note">${t('inspector.meansNote')}</p>` : ''}${terrestrial}
    <div class="neighbors-heading"><h4>${t('inspector.neighbors')}</h4><span>${t('inspector.neighborCount', { value: number(cell.neighbors.length) })}</span></div><div class="neighbor-list">${cell.neighbors.map((id) => `<button class="neighbor-button" data-neighbor="${id}" title="${t('inspector.cell', { value: id + 1 })}">${number(id + 1)}${icon('chevron')}</button>`).join('')}</div><p class="inspector-note last-note">${t('inspector.adjacencyNote')}</p>`;
  for (const button of inspector.querySelectorAll<HTMLButtonElement>('[data-neighbor]')) button.addEventListener('click', () => view.select(Number(button.dataset.neighbor)));
}
view.onSelect = inspect;
cellSelect.addEventListener('change', () => view.select(Number(cellSelect.value)));

function showStats(): void {
  if (!result) return;
  const { stats } = result.map;
  el('#stat-land').textContent = percent(stats.land_ratio, 1);
  el('#stat-landmasses').textContent = number(stats.landmasses);
  el('#stat-coast').textContent = number(stats.coastal_cells);
  el('#stat-highlands').textContent = number(stats.mountain_cells);
  el('#stat-rivers').textContent = number(stats.river_segments);
  el('#stat-lakes').textContent = number(stats.lakes);
  el('#stat-note-land').textContent = t('stats.landCount', { land: number(stats.land_cells), sea: number(stats.sea_cells) });
  el('#stat-note-landmasses').textContent = t('stats.landmassesNote');
  el('#stat-note-coast').textContent = t('stats.coastNote');
  el('#stat-note-highlands').textContent = t('stats.highlandsNote');
  el('#stat-note-rivers').textContent = t('stats.riversNote');
  el('#stat-note-lakes').textContent = t('stats.lakesNote');
}
async function regenerate(): Promise<void> {
  if (pending || !el<HTMLFormElement>('#generation-form').reportValidity()) return;
  pending = true;
  generateButton.disabled = true;
  generateButton.innerHTML = `<span>${t('settings.generating')}</span><span class="button-spinner"></span>`;
  overlay.hidden = false;
  overlay.innerHTML = `<div class="loading-orbit">${icon('world')}</div><strong>${t('map.loading')}</strong><p>${t('map.loadingDetail')}</p>`;
  const config: MapConfig = { seed: seedInput.value.trim(), cell_count: Number(countInput.value), relaxations: Number(relaxInput.value), land_ratio: Number(landInput.value) / 100 };
  try {
    result = await generateMap(config);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch { /* Optional. */ }
    view.setWorld(result.map);
    view.setLayer(layer, resource);
    view.showBorders(el<HTMLInputElement>('#show-borders').checked);
    view.showCenters(el<HTMLInputElement>('#show-centers').checked);
    view.showWater(el<HTMLInputElement>('#show-water').checked);
    cellSelect.replaceChildren(...result.map.cells.map((cell) => {
      const option = document.createElement('option');
      option.value = String(cell.id);
      option.textContent = `${t('inspector.cell', { value: number(cell.id + 1) })} · ${t(`terrain.${cell.terrain}`)}`;
      return option;
    }));
    cellSelect.disabled = false;
    const initial = result.map.cells.find((cell) => cell.is_land && cell.river_access > 15 && cell.agricultural_suitability > 25) ?? result.map.cells.find((cell) => cell.is_land)!;
    view.select(initial.id);
    showStats();
    el('#map-status').innerHTML = `<span class="status-dot"></span>${t('map.ready')}<span class="meta-divider">·</span>${t('map.cellCount', { value: number(result.map.cells.length) })}`;
    el('#map-meta').textContent = t('map.timing', { value: number(result.meta.generation_ms, 1) });
    el('#world-seed').textContent = t('map.seed', { value: result.map.config.seed });
    exportButton.disabled = false;
    overlay.hidden = true;
  } catch (error) {
    const failure = error instanceof ApiError ? error : new ApiError('error.generation');
    overlay.innerHTML = `<div class="error-symbol">!</div><strong>${t('error.title')}</strong><p>${escape(t(failure.key, failure.params))}</p><button id="retry" class="text-button">${t('error.retry')}${icon('arrow')}</button>`;
    el('#retry').addEventListener('click', () => void regenerate());
  } finally {
    pending = false;
    generateButton.disabled = false;
    generateButton.innerHTML = `<span>${t('settings.generate')}</span>${icon('arrow')}`;
  }
}
el<HTMLFormElement>('#generation-form').addEventListener('submit', (event) => { event.preventDefault(); void regenerate(); });
exportButton.addEventListener('click', () => {
  if (!result) return;
  const blob = new Blob([JSON.stringify(result.map, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `jinglun-map-${result.map.generator_version}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
renderLegend();
void regenerate();
