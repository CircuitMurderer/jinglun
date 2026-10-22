import { useState, type CSSProperties } from 'react';
import { motion } from 'motion/react';
import { number, percent, t, type MessageKey } from '../i18n';
import type { MapConfig, WorldMap } from '../types';
import { Icon, type IconName } from './Icon';
import { AnimatedNumber } from './shared';

interface Props {
  config: MapConfig;
  onChange: (config: MapConfig) => void;
  onGenerate: () => void;
  pending: boolean;
  world?: WorldMap;
}

const statDefs: Array<{ key: 'landmasses' | 'coast' | 'highlands' | 'rivers' | 'lakes'; icon: IconName; note: MessageKey; get: (s: WorldMap['stats']) => number }> = [
  { key: 'landmasses', icon: 'layers', note: 'stats.landmassesNote', get: (s) => s.landmasses },
  { key: 'coast', icon: 'drop', note: 'stats.coastNote', get: (s) => s.coastal_cells },
  { key: 'highlands', icon: 'mountain', note: 'stats.highlandsNote', get: (s) => s.mountain_cells },
  { key: 'rivers', icon: 'river', note: 'stats.riversNote', get: (s) => s.river_segments },
  { key: 'lakes', icon: 'drop', note: 'stats.lakesNote', get: (s) => s.lakes },
];

const fill = (value: number, min: number, max: number) => ({ '--p': `${((value - min) / (max - min)) * 100}%` }) as CSSProperties;

export function GenesisPanel({ config, onChange, onGenerate, pending, world }: Props) {
  const [spin, setSpin] = useState(0);
  const stats = world?.stats;
  const landRing = 2 * Math.PI * 30;
  return (
    <div className="panel-scroll">
      <section className="panel-section">
        <header className="section-head"><span className="section-index">01</span><h2>{t('settings.title')}</h2></header>
        <p className="section-sub">{t('settings.subtitle')}</p>
        <form id="generation-form" className="genesis-form" onSubmit={(event) => { event.preventDefault(); if (event.currentTarget.reportValidity()) onGenerate(); }}>
          <label htmlFor="seed" className="field-label">{t('settings.seed')}</label>
          <div className="seed-field">
            <input id="seed" name="seed" value={config.seed} maxLength={64} required placeholder={t('settings.seedPlaceholder')}
              onChange={(event) => onChange({ ...config, seed: event.target.value })} autoComplete="off" spellCheck={false} />
            <motion.button type="button" className="dice" title={t('settings.random')} aria-label={t('settings.random')}
              animate={{ rotate: spin * 360 }} transition={{ type: 'spring', stiffness: 160, damping: 14 }}
              onClick={() => { setSpin((v) => v + 1); onChange({ ...config, seed: String(crypto.getRandomValues(new Uint32Array(1))[0]) }); }}>
              <Icon name="shuffle" size={17} />
            </motion.button>
          </div>

          <div className="field-row"><label htmlFor="cell-count" className="field-label">{t('settings.count')}</label><output htmlFor="cell-count">{t('settings.countValue', { value: number(config.cell_count) })}</output></div>
          <input id="cell-count" className="slider" type="range" min={100} max={2000} step={50} value={config.cell_count} style={fill(config.cell_count, 100, 2000)}
            onChange={(event) => onChange({ ...config, cell_count: Number(event.target.value) })} />
          <div className="range-ends"><span>100</span><span>2,000</span></div>

          <span className="field-label" id="relax-label">{t('settings.relaxations')}</span>
          <div className="segmented" role="radiogroup" aria-labelledby="relax-label">
            {[0, 1, 2, 3].map((value) => (
              <button key={value} type="button" role="radio" aria-checked={config.relaxations === value}
                className={config.relaxations === value ? 'active' : ''} onClick={() => onChange({ ...config, relaxations: value })}
                title={t(`settings.relaxation.${value}` as MessageKey)}>
                {config.relaxations === value && <motion.span layoutId="relax-pill" className="pill" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
                <span className="label">{value}</span>
              </button>
            ))}
          </div>
          <p className="field-hint">{t(`settings.relaxation.${config.relaxations}` as MessageKey)}</p>

          <div className="field-row"><label htmlFor="land-ratio" className="field-label">{t('settings.land')}</label><output htmlFor="land-ratio">{percent(config.land_ratio)}</output></div>
          <input id="land-ratio" className="slider land" type="range" min={20} max={80} value={Math.round(config.land_ratio * 100)} style={fill(config.land_ratio * 100, 20, 80)}
            onChange={(event) => onChange({ ...config, land_ratio: Number(event.target.value) / 100 })} />
          <div className="land-sea"><span style={{ width: `${config.land_ratio * 100}%` }} /></div>
          <p className="field-hint">{t('settings.landSea', { land: percent(config.land_ratio), sea: percent(1 - config.land_ratio) })} · {t('settings.landHint')}</p>

          <button id="generate" className="generate-button" type="submit" disabled={pending}>
            <span className="shine" aria-hidden="true" />
            {pending ? <><span>{t('settings.generating')}</span><span className="spinner" /></> : <><Icon name="sparkle" size={17} /><span>{t('settings.generate')}</span><Icon name="arrow" size={17} /></>}
          </button>
          <p className="settings-note">{t('settings.note')}</p>
        </form>
      </section>

      <section className="panel-section" aria-live="polite">
        <header className="section-head"><span className="section-index">02</span><h2>{t('stats.title')}</h2></header>
        <div className="land-stat">
          <svg viewBox="0 0 72 72" width="72" height="72" aria-hidden="true">
            <circle cx="36" cy="36" r="30" className="ring-bg" />
            <motion.circle cx="36" cy="36" r="30" className="ring-fg" strokeDasharray={landRing} initial={false}
              animate={{ strokeDashoffset: landRing * (1 - (stats?.land_ratio ?? 0)) }} transition={{ duration: 1, ease: 'easeOut' }} />
          </svg>
          <div>
            <span className="stat-label">{t('stats.land')}</span>
            <strong className="stat-value big">{stats ? <AnimatedNumber value={stats.land_ratio} format={(v) => percent(v, 1)} /> : '—'}</strong>
            <span className="stat-note">{stats ? t('stats.landCount', { land: number(stats.land_cells), sea: number(stats.sea_cells) }) : '—'}</span>
          </div>
        </div>
        <div className="stat-grid">
          {statDefs.map(({ key, icon, note, get }) => (
            <article key={key} className="stat-card" title={t(note)}>
              <span className="stat-label"><Icon name={icon} size={14} />{t(`stats.${key}`)}</span>
              <strong className="stat-value">{stats ? <AnimatedNumber value={get(stats)} format={(v) => number(Math.round(v))} /> : '—'}</strong>
              <span className="stat-note">{t(note)}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
