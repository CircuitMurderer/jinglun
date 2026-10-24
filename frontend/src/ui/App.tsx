import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ApiError, generateMap } from '../api';
import { getLocale, number, t } from '../i18n';
import type { MapView } from '../map';
import type { Cell, Layer, MapConfig, ResourceKind } from '../types';
import { CommandPalette, HelpDialog } from './CommandPalette';
import { GenesisPanel } from './GenesisPanel';
import { Icon } from './Icon';
import { Inspector } from './Inspector';
import { Comparison } from '../comparison';
import { LayerDock } from './LayerDock';
import { MapStage, type Status, type Toggles } from './MapStage';
import { isClimateLayer, layers, loadConfig, saveConfig } from './shared';
import { useTheme } from './ThemePicker';
import { GameMenu } from './GameMenu';
import { version } from '../../../package.json';
import { worldEntryReducer } from '../world-entry';
import { WorldEntryPanel } from './WorldEntryPanel';

const compactLayoutQuery = '(max-width: 1180px)';

export function App() {
  useTheme();
  const [debug, setDebug] = useState(false);
  const [config, setConfig] = useState<MapConfig>(() => loadConfig(t('settings.defaultSeed')));
  const [entry, dispatchEntry] = useReducer(worldEntryReducer, { stage: 'setup' });
  const result = entry.result;
  const inGame = entry.stage === 'round';
  const [generationSerial, setGenerationSerial] = useState(0);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string>();
  const [layer, setLayer] = useState<Layer>('terrain');
  const [resource, setResource] = useState<ResourceKind>('iron');
  const [month, setMonth] = useState<number>();
  const [playing, setPlaying] = useState(false);
  const [toggles, setToggles] = useState<Toggles>({ water: false, borders: true, centers: false, graticule: true });
  const [selected, setSelected] = useState<Cell>();
  const [compact, setCompact] = useState(() => matchMedia(compactLayoutQuery).matches);
  const [leftOpen, setLeftOpen] = useState(() => !matchMedia(compactLayoutQuery).matches);
  const [rightOpen, setRightOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exported, setExported] = useState(false);
  const viewRef = useRef<MapView | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    document.documentElement.lang = getLocale();
  }, []);

  const runGenerate = useCallback(async (nextConfig: MapConfig) => {
    if (busy.current || entry.stage !== 'setup') return;
    busy.current = true;
    setStatus('loading');
    setError(undefined);
    const normalized: MapConfig = { ...nextConfig, seed: nextConfig.seed.trim() || t('settings.defaultSeed') };
    try {
      const response = await generateMap(normalized);
      saveConfig(normalized);
      setConfig(normalized);
      dispatchEntry({ type: 'generated', result: response });
      setLeftOpen(true);
      if (matchMedia(compactLayoutQuery).matches) setRightOpen(false);
      setGenerationSerial(serial => serial + 1);
      // Clear the old selection; MapStage selects a candidate only in debug mode.
      setSelected(undefined);
      setStatus('ready');
    } catch (err) {
      const failure = err instanceof ApiError ? err : new ApiError('error.generation');
      setError(t(failure.key, failure.params));
      setStatus('error');
    } finally {
      busy.current = false;
    }
  }, [entry.stage]);

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
    if (!debug && (!inGame || !selected)) return;
    setRightOpen((value) => !value);
    if (compact) setLeftOpen(false);
  }, [compact, debug, inGame, selected]);

  const handleMapSelect = useCallback((cell: Cell) => {
    if (!debug && !inGame) return;
    setSelected(cell);
    if (inGame) {
      setRightOpen(true);
      if (compact) setLeftOpen(false);
    }
  }, [debug, inGame, compact]);

  const handleToggle = useCallback((key: keyof Toggles) => {
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleFocus = useCallback((id: number, zoom = true) => {
    if (!debug) return;
    viewRef.current?.focus(id, zoom);
    setRightOpen(true);
    if (compact) setLeftOpen(false);
  }, [compact, debug]);

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

  const changeDebug = (enabled: boolean) => {
    setDebug(enabled);
    setPlaying(false);
    setMonth(undefined);
    setLayer('terrain');
    setPaletteOpen(false);
    setHelpOpen(false);
    setExported(false);
    if (!inGame) {
      setSelected(undefined);
      setRightOpen(enabled && !compact);
    }
    viewRef.current?.preview(undefined);
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (debug && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
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
      if (debug && key >= '1' && key <= '9') {
        event.preventDefault();
        const next = layers[Number(key) - 1].id;
        setLayer(next);
        return;
      }
      if (!debug && !['+', '=', '-', '_', 'home', '[', ']'].includes(key.toLowerCase())) return;
      switch (key.toLowerCase()) {
        case 'r': event.preventDefault(); handleToggle('water'); break;
        case 'b': event.preventDefault(); handleToggle('borders'); break;
        case 'g': event.preventDefault(); handleToggle('graticule'); break;
        case 'c': event.preventDefault(); handleToggle('centers'); break;
        case '0': event.preventDefault(); setLayer('construction'); break;
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
        case 'home':
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
  }, [debug, paletteOpen, helpOpen, layer, handleToggle, toggleLeft, toggleRight]);

  const world = result?.map;
  const leftLabel = entry.stage === 'setup' ? t('panel.settings')
    : entry.stage === 'confirm' ? t('entry.confirmPanel') : t('round.panel');
  const date = entry.stage === 'round'
    ? t('round.date', { year: number(entry.round.year), month: number(entry.round.month) }) : undefined;

  useEffect(() => {
    document.title = date ? t('round.windowTitle', { date }) : t('app.title');
  }, [date]);

  const configureWorld = () => {
    if (entry.stage !== 'confirm') return;
    dispatchEntry({ type: 'configure' });
    setStatus('idle');
    setError(undefined);
    setPlaying(false);
  };

  const confirmWorld = () => {
    if (entry.stage !== 'confirm' || busy.current) return;
    dispatchEntry({ type: 'confirm' });
    setPlaying(false);
    setMonth(undefined);
    setLayer('terrain');
    viewRef.current?.clearSelection();
    setSelected(undefined);
    setRightOpen(false);
  };

  const nextRound = () => {
    setPlaying(false);
    dispatchEntry({ type: 'next-round' });
  };

  return (
    <div className="atlas-shell" data-mode={debug ? 'debug' : 'gameplay'} data-stage={entry.stage}>
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
            <span>{debug ? t('menu.debug') : date ? t('round.eyebrow') : t('app.phase')}</span>
            <em>{version}</em>
          </span>
        </div>

        <div className={`telemetry${date && !debug ? ' has-round' : ''}`} aria-live="polite">
          <span className="telemetry-item">
            <span className={`status-dot ${status}`} />
            {date ?? (status === 'idle' ? t('entry.configure') : status === 'ready' ? t('map.ready') : status === 'loading' ? t('map.loading') : t('error.title'))}
          </span>
          {debug && result && (
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
          {debug && <>
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
          </>}
          <GameMenu debug={debug} version={version} onDebug={changeDebug} />
        </div>
      </header>

      <main className="stage-layout" data-left={leftOpen ? 'open' : 'closed'} data-right={(debug || inGame && selected) && rightOpen ? 'open' : 'closed'}>
        <MapStage
          world={world}
          debug={debug}
          inGame={inGame}
          showLegend={!!world && (!inGame || !!selected)}
          onNextRound={inGame ? nextRound : undefined}
          layer={debug ? layer : 'terrain'}
          resource={resource}
          month={debug ? month : undefined}
          toggles={debug ? toggles : { water: false, borders: true, centers: false, graticule: false }}
          status={status}
          error={error}
          onRetry={() => void runGenerate(config)}
          onSelect={handleMapSelect}
          onToggle={handleToggle}
          viewRef={viewRef}
        >
          {debug && <LayerDock
            layer={layer}
            resource={resource}
            month={month}
            playing={playing}
            onLayer={(next) => { setPlaying(false); setLayer(next); }}
            onResource={(next) => setResource(next)}
            onMonth={(next) => { setPlaying(false); setMonth(next); }}
            onPlay={() => setPlaying((v) => !v)}
          />}
        </MapStage>

        {/* World setup, map confirmation, then the first round. */}
        <aside className={`side-drawer left glass${leftOpen ? ' open' : ' collapsed'}`} aria-label={leftLabel}>
          <button
            type="button"
            className="drawer-tab"
            onClick={toggleLeft}
            aria-expanded={leftOpen}
            aria-label={t(leftOpen ? 'panel.collapse' : 'panel.expand')}
            data-tip={`${leftLabel} · [`}
          >
            <Icon name={leftOpen ? 'chevronLeft' : 'chevron'} size={15} />
            {!leftOpen && <span className="tab-vertical">{leftLabel}</span>}
          </button>
          <div className="drawer-body" inert={!leftOpen}>
            {entry.stage === 'setup' ? <>
              <div className="hero-banner">
                <p className="eyebrow">{t(debug ? 'world.eyebrow' : 'entry.eyebrow')}</p>
                <h1>{t(debug ? 'world.title' : 'entry.title')}</h1>
                <p className="sub">{t(debug ? 'world.description' : 'entry.description')}</p>
              </div>
              <GenesisPanel
                config={config}
                onChange={setConfig}
                onGenerate={() => void runGenerate(config)}
                pending={status === 'loading'}
                debug={debug}
                world={world}
              />
            </> : <WorldEntryPanel entry={entry} onConfigure={configureWorld} onConfirm={confirmWorld} />}
          </div>
        </aside>

        {/* Right Drawer: Cell Inspector */}
        {(debug || inGame && selected) && <aside className={`side-drawer right glass${rightOpen ? ' open' : ' collapsed'}`} aria-label={t('panel.inspector')}>
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
          <div className="drawer-body" inert={!rightOpen}>
            <div className="inspector-topbar">
              <div className="section-head">
                <span className="section-index">03</span>
                <h2>{t('inspector.title')}</h2>
              </div>
              {debug && <div className="cell-select-wrap">
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
              </div>}
            </div>
            {debug ? <Inspector
              comparison={<Comparison key={generationSerial} world={world} selectedId={selected?.id} month={month}
                onPeriod={next => { setPlaying(false); setMonth(next); }} onInspect={id => handleFocus(id, false)} />}
              world={world}
              cell={selected}
              month={month}
              layer={layer}
              resource={resource}
              onFocus={handleFocus}
              onPreview={handlePreview}
              onMonth={handlePickMonth}
              onResource={handlePickResource}
            /> : <div className="fogged-cell" aria-live="polite">
              <h3>{selected && t('inspector.cell', { value: number(selected.id + 1) })}</h3>
            </div>}
          </div>
        </aside>}
      </main>

      {debug && <CommandPalette
        open={paletteOpen}
        world={world}
        onClose={() => setPaletteOpen(false)}
        onCell={(id) => handleFocus(id, true)}
        onLayer={(next) => { setPlaying(false); setLayer(next); }}
        onPreview={handlePreview}
      />}

      {debug && <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />}

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
