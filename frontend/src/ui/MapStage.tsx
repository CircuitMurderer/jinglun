import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { MapView, cellFill, latitudeAt, legendGradient, terrainColors, terrainColor, geologyColors, geologyColor } from '../map';
import { useTheme } from './ThemePicker';
import { screenTransform } from '../map-camera';
import { drawNaturalMinimap, effectiveMapStyle, naturalTerrainPaints, type MapStyle } from '../map-style';
import { number, percent, t, type MessageKey } from '../i18n';
import type { Cell, Layer, Point, ResourceKind, Terrain, WorldMap } from '../types';
import { Icon, type IconName } from './Icon';
import { initialCell, locationKey } from './shared';

export interface Toggles { water: boolean; borders: boolean; centers: boolean; graticule: boolean }
export type Status = 'loading' | 'ready' | 'error';

interface Props {
  world?: WorldMap;
  layer: Layer;
  resource: ResourceKind;
  month?: number;
  toggles: Toggles;
  status: Status;
  error?: string;
  onRetry: () => void;
  onSelect: (cell: Cell) => void;
  onToggle: (key: keyof Toggles) => void;
  viewRef: RefObject<MapView | null>;
  children?: ReactNode;
}

function latitudeText(lat: number): string {
  const value = Math.round(Math.abs(lat));
  return value === 0 ? t('map.equator') : t(lat > 0 ? 'map.latN' : 'map.latS', { value });
}

export function layerReading(cell: Cell, layer: Layer, resource: ResourceKind, month?: number): [string, string] {
  switch (layer) {
    case 'temperature': return month === undefined
      ? [t('climate.annualTemperature'), t('unit.celsius', { value: number(cell.temperature_c, 1) })]
      : [t('climate.monthTemperature', { value: month + 1 }), t('unit.celsius', { value: number(cell.climate.months[month].temperature_c, 1) })];
    case 'rainfall': return month === undefined
      ? [t('climate.annualPrecipitation'), t('unit.mm', { value: number(cell.rainfall_mm) })]
      : [t('climate.monthPrecipitation', { value: month + 1 }), t('unit.mm', { value: number(cell.climate.months[month].precipitation_mm) })];
    case 'water': return [t('layer.water'), cell.is_land ? t(`moisture.${cell.moisture_zone}`) : '—'];
    case 'soil': return [t('inspector.fertility'), cell.is_land ? number(cell.soil_quality) : '—'];
    case 'agriculture': return [t('inspector.agriculture'), cell.is_land ? number(cell.agricultural_suitability) : '—'];
    case 'resources': return [t(`resource.${resource}`), number(cell.resources.find((r) => r.kind === resource)?.potential ?? 0)];
    case 'geology': return [t('layer.geology'), t(`geology.kind.${cell.geology_kind}`)];
    case 'construction': return [t('land.buildable'), percent(cell.construction.buildable_fraction, 1)];
    default: return [t('inspector.elevation'), t('unit.m', { value: number(cell.elevation_m) })];
  }
}

/* ---------- Hover card that follows the pointer, updated imperatively ---------- */
interface TooltipHandle { show(cell: Cell | undefined, x: number, y: number): void }
function Tooltip({ ref, layer, resource, month }: { ref: Ref<TooltipHandle>; layer: Layer; resource: ResourceKind; month?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState<Cell>();
  useImperativeHandle(ref, () => ({
    show(next, x, y) {
      setCell(next);
      const element = box.current;
      if (!element || !next) return;
      const { innerWidth, innerHeight } = window;
      const width = element.offsetWidth || 220, height = element.offsetHeight || 120;
      const left = x + 18 + width > innerWidth - 8 ? x - width - 18 : x + 18;
      const top = Math.min(innerHeight - height - 8, Math.max(8, y + 14));
      element.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    },
  }), []);
  const [label, value] = cell ? layerReading(cell, layer, resource, month) : ['', ''];
  return createPortal(
    <div ref={box} className={`map-tooltip${cell ? ' visible' : ''}`} role="presentation">
      {cell && <>
        <div className="tooltip-head">
          <i style={{ background: terrainColor(cell.terrain) }} />
          <strong>{t('inspector.cell', { value: number(cell.id + 1) })}</strong>
          <span>{t(`terrain.${cell.terrain}`)}</span>
        </div>
        <div className="tooltip-reading"><span>{label}</span><b>{value}</b></div>
        <div className="tooltip-meta">{t(locationKey(cell))} · {t('unit.m', { value: number(cell.elevation_m) })} · {t('unit.celsius', { value: number(cell.temperature_c, 1) })}</div>
        <div className="tooltip-hint">{t('tooltip.hint')}</div>
      </>}
    </div>,
    document.body,
  );
}

/* ---------- Overview map with live viewport frame ---------- */
function Minimap({ world, layer, resource, month, viewRef, mapStyle, relief }: { relief: boolean; mapStyle: MapStyle; world: WorldMap; layer: Layer; resource: ResourceKind; month?: number; viewRef: RefObject<MapView | null> }) {
  const { resolved: theme } = useTheme();
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const W = 208, H = Math.round(208 * world.height / world.width);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    element.width = W * ratio; element.height = H * ratio;
    context.setTransform(ratio * W / world.width, 0, 0, ratio * H / world.height, 0, 0);
    if (effectiveMapStyle(mapStyle, layer, world) === 'natural') {
      drawNaturalMinimap(context, world, terrainColor, relief);
      return;
    }
    for (const cell of world.cells) {
      context.beginPath();
      cell.polygon.forEach((p, i) => (i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)));
      context.closePath();
      context.fillStyle = cellFill(cell, layer, resource, month);
      context.fill();
      context.strokeStyle = context.fillStyle;
      context.lineWidth = 1;
      context.stroke();
    }
  }, [world, layer, resource, month, W, H, theme, mapStyle, relief]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    return view.camera.subscribe((state) => {
      const element = frame.current;
      if (!element) return;
      const { scale, x, y } = screenTransform(state);
      const left = Math.max(0, -x / scale), top = Math.max(0, -y / scale);
      const right = Math.min(state.width, (state.viewportWidth - x) / scale);
      const bottom = Math.min(state.height, (state.viewportHeight - y) / scale);
      const k = W / state.width;
      element.style.left = `${left * k}px`; element.style.top = `${top * k}px`;
      element.style.width = `${Math.max(0, right - left) * k}px`; element.style.height = `${Math.max(0, bottom - top) * k}px`;
    });
  }, [viewRef, world, W]);
  const press = useRef(false);
  const move = (event: React.PointerEvent, duration: number) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const point: Point = { x: (event.clientX - rect.left) / rect.width * world.width, y: (event.clientY - rect.top) / rect.height * world.height };
    viewRef.current?.flyTo(point, undefined, duration);
  };
  return (
    <div className="minimap glass" style={{ width: W, height: H }} title={t('map.minimap')}
      onPointerDown={(event) => { press.current = true; event.currentTarget.setPointerCapture(event.pointerId); move(event, 420); }}
      onPointerMove={(event) => { if (press.current) move(event, 0); }}
      onPointerUp={() => { press.current = false; }} onPointerCancel={() => { press.current = false; }}>
      <canvas ref={canvas} style={{ width: W, height: H }} aria-label={t('map.minimap')} role="img" />
      <div ref={frame} className="minimap-frame" />
    </div>
  );
}

/* ---------- Legend ---------- */
function Legend({ world, layer, resource, month, mapStyle }: { mapStyle: MapStyle; world?: WorldMap; layer: Layer; resource: ResourceKind; month?: number }) {
  if (layer === 'geology') return <div className="legend glass"><strong className="legend-title">{t('layer.geology')}</strong><div className="terrain-legend">{(Object.keys(geologyColors) as Array<keyof typeof geologyColors>).map(kind => <span key={kind}><i style={{ background: geologyColor(kind) }} />{t(`geology.kind.${kind}`)}</span>)}</div></div>;
  if (layer === 'terrain') {
    const present = new Set<Terrain>(world && effectiveMapStyle(mapStyle, layer, world) === 'natural'
      ? ['deep_ocean', 'shallow_sea', 'plains', ...naturalTerrainPaints(world).map(paint => paint.terrain)]
      : world?.cells.map((cell) => cell.terrain) ?? []);
    const order = Object.keys(terrainColors) as Terrain[];
    const shown = world ? order.filter((kind) => present.has(kind)) : order;
    return (
      <div className="legend glass">
        <strong className="legend-title">{t('layer.terrain')}</strong>
        <div className="terrain-legend">{shown.map((kind) => <span key={kind}><i style={{ background: terrainColor(kind) }} />{t(`terrain.${kind}`)}</span>)}</div>
      </div>
    );
  }
  const labels: Record<Exclude<Layer, 'terrain' | 'geology'>, readonly [MessageKey, MessageKey]> = {
    elevation: ['legend.elevationMin', 'legend.elevationMax'], rainfall: ['legend.rainfallMin', 'legend.rainfallUpper'],
    temperature: ['legend.temperatureMin', 'legend.temperatureMax'],
    water: ['legend.waterMin', 'legend.waterMax'], soil: ['legend.soilMin', 'legend.soilMax'],
    agriculture: ['legend.agricultureMin', 'legend.agricultureMax'], resources: ['legend.resourceMin', 'legend.resourceMax'],
    construction: ['land.difficult', 'land.favorable'],
  };
  const [low, high] = labels[layer];
  const monthly = month !== undefined && (layer === 'temperature' || layer === 'rainfall');
  const title = layer === 'resources' ? t(`resource.${resource}`) : monthly
    ? t(layer === 'temperature' ? 'climate.monthTemperature' : 'climate.monthPrecipitation', { value: month + 1 })
    : layer === 'temperature' ? t('climate.annualTemperature') : layer === 'rainfall' ? t('climate.annualPrecipitation') : t(`layer.${layer}`);
  return (
    <div className="legend glass">
      <AnimatePresence mode="wait" initial={false}>
        <motion.strong key={title} className="legend-title" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.18 }}>{title}</motion.strong>
      </AnimatePresence>
      <div className="legend-ramp" style={{ background: legendGradient(layer) }} />
      {layer === 'water' && <p className="note">{t('water.mapNote', { period: month === undefined ? t('climate.annual') : t('climate.month', { value: month + 1 }) })}</p>}
      {layer === 'construction' && <p className="note">{t('land.mapNote')}</p>}
      <div className="legend-labels"><span>{t(low)}</span><span>{t(monthly && layer === 'rainfall' ? 'legend.monthRainfallUpper' : high)}</span></div>
    </div>
  );
}

/* ---------- Loading / error overlay ---------- */
function Astrolabe() {
  return (
    <svg className="astrolabe" viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <radialGradient id="globe" cx="40%" cy="35%"><stop offset="0" stopColor="var(--accent-jade)" stopOpacity="0.55" /><stop offset="1" stopColor="var(--map-deep-ocean)" stopOpacity="0.1" /></radialGradient>
      </defs>
      <g className="ring ring-a"><circle cx="100" cy="100" r="92" />{Array.from({ length: 72 }, (_, i) => <line key={i} x1="100" y1="8" x2="100" y2={i % 6 ? 13 : 18} transform={`rotate(${i * 5} 100 100)`} />)}</g>
      <g className="ring ring-b"><ellipse cx="100" cy="100" rx="74" ry="26" /><ellipse cx="100" cy="100" rx="26" ry="74" /><circle cx="174" cy="100" r="3.5" className="planet" /></g>
      <g className="ring ring-c"><ellipse cx="100" cy="100" rx="60" ry="60" strokeDasharray="2 6" /><circle cx="100" cy="40" r="2.5" className="planet gold" /></g>
      <circle cx="100" cy="100" r="40" fill="url(#globe)" className="globe" />
      <g className="globe-lines"><ellipse cx="100" cy="100" rx="40" ry="14" /><ellipse cx="100" cy="100" rx="14" ry="40" /><line x1="60" y1="100" x2="140" y2="100" /></g>
    </svg>
  );
}
function Overlay({ status, error, onRetry, first }: { status: Status; error?: string; onRetry: () => void; first: boolean }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (status !== 'loading') return;
    setPhase(0);
    const timer = setInterval(() => setPhase((value) => (value + 1) % 4), 1100);
    return () => clearInterval(timer);
  }, [status]);
  return (
    <AnimatePresence>
      {status !== 'ready' && (
        <motion.div className={`map-overlay${first ? ' first' : ''}`} aria-live="polite"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.5 } }}>
          {status === 'loading' && <div className="scanline" />}
          <motion.div className="overlay-card" initial={{ scale: 0.92, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 1.06, opacity: 0 }}>
            {status === 'loading' ? <>
              <Astrolabe />
              <strong>{t('map.loading')}</strong>
              <AnimatePresence mode="wait">
                <motion.p key={phase} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
                  {t(`map.loadingPhase.${phase}` as MessageKey)}
                </motion.p>
              </AnimatePresence>
              <div className="progress"><span /></div>
            </> : <>
              <div className="error-symbol">!</div>
              <strong>{t('error.title')}</strong>
              <p>{error}</p>
              <button type="button" className="ghost-button" onClick={onRetry}>{t('error.retry')}<Icon name="arrow" size={16} /></button>
            </>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- Stage ---------- */
const toggleDefs: Array<{ key: keyof Toggles; icon: IconName; label: MessageKey; kbd: string }> = [
  { key: 'water', icon: 'river', label: 'layers.water', kbd: 'R' },
  { key: 'borders', icon: 'border', label: 'layers.borders', kbd: 'B' },
  { key: 'graticule', icon: 'grid', label: 'map.graticule', kbd: 'G' },
  { key: 'centers', icon: 'dot', label: 'layers.centers', kbd: 'C' },
];

export function MapStage({ world, layer, resource, month, toggles, status, error, onRetry, onSelect, onToggle, viewRef, children }: Props) {
  const { resolved: theme } = useTheme();
  const [mapStyle, setMapStyle] = useState<MapStyle>('classic');
  const [naturalOptions, setNaturalOptions] = useState({ relief: true, symbols: true });
  const activeStyle = effectiveMapStyle(mapStyle, layer, world);
  const host = useRef<HTMLDivElement>(null);
  const tooltip = useRef<TooltipHandle>(null);
  const zoomLabel = useRef<HTMLSpanElement>(null);
  const cursorLabel = useRef<HTMLSpanElement>(null);
  const latest = useRef({ onSelect, world, layer, resource, month, toggles, mapStyle });
  latest.current = { onSelect, world, layer, resource, month, toggles, mapStyle };
  const [mounted, setMounted] = useState(false);
  const [everReady, setEverReady] = useState(false);

  useEffect(() => {
    const view = new MapView(host.current!);
    viewRef.current = view;
    view.onSelect = (cell) => latest.current.onSelect(cell);
    view.onHover = (cell, x, y) => tooltip.current?.show(cell, x, y);
    view.onZoom = (scale) => { if (zoomLabel.current) zoomLabel.current.textContent = t('map.zoom', { value: percent(scale) }); };
    view.onCursor = (point) => {
      const element = cursorLabel.current;
      const current = latest.current.world;
      if (!element) return;
      element.textContent = point && current
        ? `${t('map.cursor', { x: number(point.x), y: number(point.y) })} · ${latitudeText(latitudeAt(current, point.y))}`
        : t('map.cursorIdle');
    };
    const onPageHide = (event: PageTransitionEvent) => { if (!event.persisted) view.destroy(); };
    window.addEventListener('pagehide', onPageHide);
    setMounted(true);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      view.destroy();
      viewRef.current = null;
    };
  }, [viewRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !world) return;
    const { layer: l, resource: r, month: m, toggles: tg } = latest.current;
    view.setMonth(m);
    view.setLayer(l, r);
    view.setMapStyle(latest.current.mapStyle);
    view.setWorld(world);
    view.showBorders(tg.borders);
    view.showCenters(tg.centers);
    view.showGraticule(tg.graticule);
    view.showWater(tg.water);
    view.select(initialCell(world.cells).id);
  }, [world, viewRef, mounted]);

  useEffect(() => { viewRef.current?.setNaturalOptions(naturalOptions); }, [naturalOptions, viewRef, mounted]);
  useEffect(() => { viewRef.current?.setMapStyle(mapStyle); }, [mapStyle, viewRef, mounted]);
  useEffect(() => { viewRef.current?.setMonth(month); }, [month, viewRef, mounted]);
  useEffect(() => { viewRef.current?.setLayer(layer, resource); }, [layer, resource, viewRef, mounted, theme]);
  useEffect(() => { viewRef.current?.showBorders(toggles.borders); }, [toggles.borders, viewRef, mounted]);
  useEffect(() => { viewRef.current?.showCenters(toggles.centers); }, [toggles.centers, viewRef, mounted]);
  useEffect(() => { viewRef.current?.showGraticule(toggles.graticule); }, [toggles.graticule, viewRef, mounted]);
  useEffect(() => { viewRef.current?.showWater(toggles.water); }, [toggles.water, viewRef, mounted]);
  useEffect(() => { if (status === 'ready') setEverReady(true); }, [status]);

  return (
    <section className="map-stage" data-layer={layer} data-map-style={activeStyle}>
      <div className="map-host" ref={host} />
      <div className="stage-vignette" aria-hidden="true" />
      <div className="stage-corners" aria-hidden="true"><i /><i /><i /><i /></div>

      <div className="hud hud-top-left">
        <div className="map-style-switch glass" role="group" aria-label={t('map.styleLabel')}>
          {(['classic', 'natural'] as const).map(style => <button key={style} type="button"
            aria-pressed={mapStyle === style} className={mapStyle === style ? 'active' : ''}
            onClick={() => setMapStyle(style)}>{t(`map.style.${style}`)}</button>)}
        </div>
        <p className="map-style-note glass" role="status">
          {mapStyle === 'classic' ? t('map.styleClassicNote') : layer !== 'terrain' ? t('map.styleThematicNote')
            : world && activeStyle !== 'natural' ? t('map.styleUnavailable') : t('map.styleNaturalNote')}
        </p>
        {activeStyle === 'natural' && world?.environment.natural_surface?.detail && <div className="natural-options glass" role="group" aria-label={t('map.detailOptions')}>
          {(['relief', 'symbols'] as const).map(key => <button type="button" key={key} aria-pressed={naturalOptions[key]}
            onClick={() => setNaturalOptions(prev => ({ ...prev, [key]: !prev[key] }))} title={t(`map.detail.${key}Hint`)}>{t(`map.detail.${key}`)}</button>)}
        </div>}
        <Legend world={world} layer={layer} resource={resource} month={month} mapStyle={activeStyle} />
        {toggles.water && <div className="readout glass">{t('water.riverPeriod', { period: month === undefined ? t('climate.annual') : t('climate.month', { value: month + 1 }) })}</div>}
        <div className="readout glass">
          <span ref={zoomLabel}>{t('map.zoom', { value: percent(1) })}</span>
          <span ref={cursorLabel}>{t('map.cursorIdle')}</span>
        </div>
      </div>

      <div className="hud hud-top-right">
        {world && mounted && <Minimap world={world} layer={layer} resource={resource} month={month} viewRef={viewRef} mapStyle={activeStyle} relief={naturalOptions.relief} />}
        <div className="compass" aria-hidden="true">
          <svg viewBox="0 0 40 40" width="40" height="40">
            <circle cx="20" cy="20" r="17" />
            <path d="M20 5 25 20 20 17 15 20Z" className="north" />
            <path d="M20 35 15 20 20 23 25 20Z" className="south" />
          </svg>
          <span>{t('map.north')}</span>
        </div>
      </div>

      <div className="hud hud-right">
        <div className="tool-column glass" role="group" aria-label={t('map.toggles')}>
          {toggleDefs.map(({ key, icon, label, kbd }) => (
            <button key={key} type="button" className={`tool-button${toggles[key] ? ' on' : ''}`} aria-pressed={toggles[key]}
              onClick={() => onToggle(key)} data-tip={`${t(label)} · ${kbd}`} aria-label={t(label)}
              title={key === 'water' ? t('layers.waterHint') : undefined}>
              <Icon name={icon} size={17} />
            </button>
          ))}
        </div>
        <div className="tool-column glass">
          <button type="button" className="tool-button" onClick={() => viewRef.current?.zoom(1.3)} aria-label={t('map.zoomIn')} data-tip={`${t('map.zoomIn')} · +`}><Icon name="plus" size={17} /></button>
          <button type="button" className="tool-button" onClick={() => viewRef.current?.zoom(1 / 1.3)} aria-label={t('map.zoomOut')} data-tip={`${t('map.zoomOut')} · −`}><Icon name="minus" size={17} /></button>
          <button type="button" className="tool-button" onClick={() => viewRef.current?.reset()} aria-label={t('map.reset')} data-tip={`${t('map.reset')} · Home`}><Icon name="fit" size={17} /></button>
        </div>
      </div>

      <div className="hud hud-bottom">{children}</div>
      <div className="instructions" aria-hidden="true">{t('map.instructions')}</div>

      <Overlay status={status} error={error} onRetry={onRetry} first={!everReady} />
      <Tooltip ref={tooltip} layer={layer} resource={resource} month={month} />
    </section>
  );
}
