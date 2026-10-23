import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ApiError, generateMap } from '../api';
import { getLocale, number, t } from '../i18n';
import type { MapView } from '../map';
import type { Cell, Layer, MapConfig, MapResponse, ResourceKind } from '../types';
import { CommandPalette, HelpDialog } from './CommandPalette';
import { GenesisPanel } from './GenesisPanel';
import { Icon } from './Icon';
import { Inspector } from './Inspector';
import { LayerDock } from './LayerDock';
import { MapStage, type Status, type Toggles } from './MapStage';
import { initialCell, isClimateLayer, layers, loadConfig, saveConfig } from './shared';
import { ThemePicker, useTheme } from './ThemePicker';

const compactLayoutQuery = '(max-width: 1180px)';

export function App() {
  useTheme();
  const [config, setConfig] = useState<MapConfig>(() => loadConfig(t('settings.defaultSeed')));
  const [result, setResult] = useState<MapResponse>();
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string>();
  const [layer, setLayer] = useState<Layer>('terrain');
  const [resource, setResource] = useState<ResourceKind>('iron');
  const [month, setMonth] = useState<number>();
  const [playing, setPlaying] = useState(false);
  const [toggles, setToggles] = useState<Toggles>({ water: false, borders: true, centers: false, graticule: true });
  const [selected, setSelected] = useState<Cell>();
  const [compact, setCompact] = useState(() => matchMedia(compactLayoutQuery).matches);
  const [leftOpen, setLeftOpen] = useState(() => !matchMedia(compactLayoutQuery).matches);
  const [rightOpen, setRightOpen] = useState(() => !matchMedia(compactLayoutQuery).matches);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exported, setExported] = useState(false);
  const viewRef = useRef<MapView | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    document.title = t('app.title');
    document.documentElement.lang = getLocale();
  }, []);

  const runGenerate = useCallback(async (nextConfig: MapConfig) => {
    if (busy.current) return;
    busy.current = true;
    setStatus('loading');
    setError(undefined);
    const normalized: MapConfig = { ...nextConfig, seed: nextConfig.seed.trim() || t('settings.defaultSeed') };
    try {
      const response = await generateMap(normalized);
      saveConfig(normalized);
      setResult(response);
      // Update both in the same render, including when the new world has fewer cells.
      setSelected(initialCell(response.map.cells));
      setStatus('ready');
    } catch (err) {
      const failure = err instanceof ApiError ? err : new ApiError('error.generation');
      setError(t(failure.key, failure.params));
      setStatus('error');
    } finally {
      busy.current = false;
    }
  }, []);

  const initialConfig = useRef(config);
  useEffect(() => { void runGenerate(initialConfig.current); }, [runGenerate]);

  // Seasonal playback timer
  useEffect(() => {
    if (!playing) return;
    if (!isClimateLayer(layer)) { setPlaying(false); return; }
    setMonth((prev) => prev ?? 0);
    const timer = setInterval(() => {
      setMonth((prev) => ((prev ?? -1) + 1) % 12);
    }, 850);
    return () => clearInterval(timer);
  }, [playing, layer]);

  useEffect(() => {
    const query = matchMedia(compactLayoutQuery);
    const update = () => {
      setCompact(query.matches);
      if (query.matches) { setLeftOpen(false); setRightOpen(false); }
    };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const toggleLeft = useCallback(() => {
    setLeftOpen((value) => !value);
    if (compact) setRightOpen(false);
  }, [compact]);

  const toggleRight = useCallback(() => {
    setRightOpen((value) => !value);
    if (compact) setLeftOpen(false);
  }, [compact]);

  const handleToggle = useCallback((key: keyof Toggles) => {
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleFocus = useCallback((id: number, zoom = true) => {
    viewRef.current?.focus(id, zoom);
    setRightOpen(true);
    if (compact) setLeftOpen(false);
  }, [compact]);

  const handlePreview = useCallback((id?: number) => {
    viewRef.current?.preview(id);
  }, []);

  const handlePickMonth = useCallback((m: number, targetLayer?: Layer) => {
    setPlaying(false);
    setMonth(m);
    if (targetLayer) setLayer(targetLayer);
    else if (!isClimateLayer(layer)) setLayer('temperature');
  }, [layer]);

  const handlePickResource = useCallback((kind: ResourceKind) => {
    setResource(kind);
    setLayer('resources');
  }, []);

  const handleExport = useCallback(() => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.map, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jinglun-map-${result.map.generator_version}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExported(true);
    setTimeout(() => setExported(false), 2200);
  }, [result]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (paletteOpen || helpOpen) {
        if (event.key === 'Escape') { setPaletteOpen(false); setHelpOpen(false); }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;
      if (key >= '1' && key <= '8') {
        event.preventDefault();
        const next = layers[Number(key) - 1].id;
        setLayer(next);
        return;
      }
      switch (key.toLowerCase()) {
        case 'r': event.preventDefault(); handleToggle('water'); break;
        case 'b': event.preventDefault(); handleToggle('borders'); break;
        case 'g': event.preventDefault(); handleToggle('graticule'); break;
        case 'c': event.preventDefault(); handleToggle('centers'); break;
        case ' ':
          // Space activates the focused control; only the map/background uses playback.
          if (target?.closest('button, a[href], summary, [role="button"], [role="radio"], [role="checkbox"]')) return;
          event.preventDefault();
          if (!isClimateLayer(layer)) { setLayer('temperature'); setMonth(0); setPlaying(true); }
          else setPlaying((v) => !v);
          break;
        case 'arrowleft':
          event.preventDefault();
          setPlaying(false);
          if (!isClimateLayer(layer)) setLayer('temperature');
          setMonth((prev) => (prev === undefined ? 11 : (prev + 11) % 12));
          break;
        case 'arrowright':
          event.preventDefault();
          setPlaying(false);
          if (!isClimateLayer(layer)) setLayer('temperature');
          setMonth((prev) => (prev === undefined ? 0 : (prev + 1) % 12));
          break;
        case '+':
        case '=':
          event.preventDefault();
          viewRef.current?.zoom(1.3);
          break;
        case '-':
        case '_':
          event.preventDefault();
          viewRef.current?.zoom(1 / 1.3);
          break;
        case '0':
          event.preventDefault();
          viewRef.current?.reset();
          break;
        case '[':
          event.preventDefault();
          toggleLeft();
          break;
        case ']':
          event.preventDefault();
          toggleRight();
          break;
        case '?':
        case '/':
          event.preventDefault();
          setHelpOpen((v) => !v);
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen, helpOpen, layer, handleToggle, toggleLeft, toggleRight]);

  const world = result?.map;

  return (
    <div className="atlas-shell">
      <header className="topbar glass">
        <div className="brand-group">
          <a className="brand" href="/" aria-label={t('app.name')}>
            <span className="brand-mark"><Icon name="mountain" size={18} /></span>
            <span className="brand-name">{t('app.name')}</span>
            <span className="brand-tagline">{t('app.tagline')}</span>
          </a>
          <span className="divider" aria-hidden="true" />
          <span className="phase-badge">
            <span className={`status-dot ${status}`} />
            <span>{t('app.phase')}</span>
            <em>{t('app.version')}</em>
          </span>
        </div>

        <div className="telemetry" aria-live="polite">
          <span className="telemetry-item">
            <span className={`status-dot ${status}`} />
            {status === 'ready' ? t('map.ready') : status === 'loading' ? t('map.loading') : t('error.title')}
          </span>
          {result && (
            <>
              <span className="sep">·</span>
              <span className="telemetry-item">{t('map.cellCount', { value: number(result.map.cells.length) })}</span>
              <span className="sep">·</span>
              <span className="telemetry-item mono">{t('map.timing', { value: number(result.meta.generation_ms, 1) })}</span>
              <span className="sep hide-sm">·</span>
              <span className="telemetry-item seed-pill hide-sm" title={result.map.config.seed}>
                {t('map.seed', { value: result.map.config.seed })}
              </span>
            </>
          )}
        </div>

        <div className="topbar-actions">
          <ThemePicker />
          <button type="button" className="search-trigger" onClick={() => setPaletteOpen(true)} aria-label={t('palette.open')}>
            <Icon name="search" size={15} />
            <span>{selected ? `${t('inspector.cell', { value: number(selected.id + 1) })} · ${t(`terrain.${selected.terrain}`)}` : t('palette.open')}</span>
            <kbd>⌘K</kbd>
          </button>

          <button type="button" className="icon-btn" onClick={() => setHelpOpen(true)} aria-label={t('shortcuts.open')} data-tip={`${t('shortcuts.open')} · ?`}>
            <Icon name="keyboard" size={17} />
          </button>

          <button id="export" type="button" className="export-btn" disabled={!result} onClick={handleExport}>
            <Icon name="download" size={16} />
            <span>{exported ? t('map.exported') : t('map.export')}</span>
          </button>
        </div>
      </header>

      <main className="stage-layout" data-left={leftOpen ? 'open' : 'closed'} data-right={rightOpen ? 'open' : 'closed'}>
        <MapStage
          world={world}
          layer={layer}
          resource={resource}
          month={month}
          toggles={toggles}
          status={status}
          error={error}
          onRetry={() => void runGenerate(config)}
          onSelect={setSelected}
          onToggle={handleToggle}
          viewRef={viewRef}
        >
          <LayerDock
            layer={layer}
            resource={resource}
            month={month}
            playing={playing}
            onLayer={(next) => { setPlaying(false); setLayer(next); }}
            onResource={(next) => setResource(next)}
            onMonth={(next) => { setPlaying(false); setMonth(next); }}
            onPlay={() => setPlaying((v) => !v)}
          />
        </MapStage>

        {/* Left Drawer: World Genesis + Macro Stats */}
        <aside className={`side-drawer left glass${leftOpen ? ' open' : ' collapsed'}`} aria-label={t('panel.settings')}>
          <button
            type="button"
            className="drawer-tab"
            onClick={toggleLeft}
            aria-expanded={leftOpen}
            aria-label={t(leftOpen ? 'panel.collapse' : 'panel.expand')}
            data-tip={`${t('panel.settings')} · [`}
          >
            <Icon name={leftOpen ? 'chevronLeft' : 'chevron'} size={15} />
            {!leftOpen && <span className="tab-vertical">{t('panel.settings')}</span>}
          </button>
          <div className="drawer-body">
            <div className="hero-banner">
              <p className="eyebrow">{t('world.eyebrow')}</p>
              <h1>{t('world.title')}</h1>
              <p className="sub">{t('world.description')}</p>
            </div>
            <GenesisPanel
              config={config}
              onChange={setConfig}
              onGenerate={() => void runGenerate(config)}
              pending={status === 'loading'}
              world={world}
            />
          </div>
        </aside>

        {/* Right Drawer: Cell Inspector */}
        <aside className={`side-drawer right glass${rightOpen ? ' open' : ' collapsed'}`} aria-label={t('panel.inspector')}>
          <button
            type="button"
            className="drawer-tab"
            onClick={toggleRight}
            aria-expanded={rightOpen}
            aria-label={t(rightOpen ? 'panel.collapse' : 'panel.expand')}
            data-tip={`${t('panel.inspector')} · ]`}
          >
            <Icon name={rightOpen ? 'chevron' : 'chevronLeft'} size={15} />
            {!rightOpen && <span className="tab-vertical">{t('panel.inspector')}</span>}
          </button>
          <div className="drawer-body">
            <div className="inspector-topbar">
              <div className="section-head">
                <span className="section-index">03</span>
                <h2>{t('inspector.title')}</h2>
              </div>
              <div className="cell-select-wrap">
                <select
                  id="cell-select"
                  aria-label={t('inspector.choose')}
                  disabled={!world}
                  value={selected?.id ?? ''}
                  onChange={(event) => viewRef.current?.select(Number(event.target.value))}
                >
                  {world?.cells.map((cell) => (
                    <option key={cell.id} value={cell.id}>
                      {t('inspector.cell', { value: number(cell.id + 1) })} · {t(`terrain.${cell.terrain}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Inspector
              world={world}
              cell={selected}
              month={month}
              layer={layer}
              resource={resource}
              onFocus={handleFocus}
              onPreview={handlePreview}
              onMonth={handlePickMonth}
              onResource={handlePickResource}
            />
          </div>
        </aside>
      </main>

      <CommandPalette
        open={paletteOpen}
        world={world}
        onClose={() => setPaletteOpen(false)}
        onCell={(id) => handleFocus(id, true)}
        onLayer={(next) => { setPlaying(false); setLayer(next); }}
        onPreview={handlePreview}
      />

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />

      <AnimatePresence>
        {exported && (
          <motion.div className="toast glass" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}>
            <Icon name="sparkle" size={15} />
            <span>{t('map.exported')}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
