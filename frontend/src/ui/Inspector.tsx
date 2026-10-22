import { AnimatePresence, motion } from 'motion/react';
import { number, percent, t } from '../i18n';
import { latitudeAt, terrainColors } from '../map';
import type { Cell, Layer, ResourceKind, WorldMap } from '../types';
import { ClimateChart, Gauge, ResourceRadar } from './Charts';
import { Icon } from './Icon';
import { AnimatedNumber, locationKey } from './shared';

interface Props {
  world?: WorldMap;
  cell?: Cell;
  month?: number;
  layer: Layer;
  resource: ResourceKind;
  onFocus: (id: number, zoom?: boolean) => void;
  onPreview: (id?: number) => void;
  onMonth: (month: number) => void;
  onResource: (kind: ResourceKind) => void;
}

function Silhouette({ cell }: { cell: Cell }) {
  const xs = cell.polygon.map((p) => p.x), ys = cell.polygon.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const size = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  const k = 64 / size;
  const ox = (88 - (Math.max(...xs) - minX) * k) / 2, oy = (88 - (Math.max(...ys) - minY) * k) / 2;
  const pts = cell.polygon.map((p) => `${(ox + (p.x - minX) * k).toFixed(1)},${(oy + (p.y - minY) * k).toFixed(1)}`).join(' ');
  return (
    <svg className="silhouette" viewBox="0 0 88 88" width="88" height="88" aria-hidden="true">
      <circle cx="44" cy="44" r="42" className="sil-ring" />
      <circle cx="44" cy="44" r="36" className="sil-ring dashed" />
      <motion.polygon points={pts} fill={terrainColors[cell.terrain]} className="sil-shape"
        initial={{ scale: 0.6, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 18 }}
        style={{ transformOrigin: '44px 44px' }} />
    </svg>
  );
}

const section = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.04 * i, duration: 0.35, ease: [0.2, 0.7, 0.2, 1] as const } }),
};

export function Inspector({ world, cell, month, layer, resource, onFocus, onPreview, onMonth, onResource }: Props) {
  if (!world || !cell) {
    return (
      <div className="panel-scroll inspector-empty">
        <Icon name="compass" size={42} />
        <h3>{t('inspector.emptyTitle')}</h3>
        <p>{t('inspector.emptyDescription')}</p>
      </div>
    );
  }
  const hasLand = cell.land_fraction > 0;
  const lat = latitudeAt(world, cell.centroid.y);
  const latText = Math.round(Math.abs(lat)) === 0 ? t('map.equator') : t(lat > 0 ? 'map.latN' : 'map.latS', { value: number(Math.abs(lat), 1) });
  const metrics: Array<[string, number, (v: number) => string]> = [
    [t('inspector.elevation'), cell.elevation_m, (v) => t('unit.m', { value: number(Math.round(v)) })],
    [t('inspector.rainfall'), cell.rainfall_mm, (v) => t('unit.mm', { value: number(Math.round(v)) })],
    [t('inspector.temperature'), cell.temperature_c, (v) => t('unit.celsius', { value: number(v, 1) })],
    [t('inspector.landFraction'), cell.land_fraction, (v) => percent(v, 1)],
    [t('inspector.landShare'), cell.area / (world.width * world.height), (v) => percent(v, 2)],
    [t('inspector.lakeFraction'), cell.lake_fraction, (v) => percent(v, 1)],
  ];
  let i = 0;
  return (
    <div className="panel-scroll">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={cell.id} initial="hidden" animate="show" exit={{ opacity: 0, x: 16, transition: { duration: 0.12 } }}>
          <motion.header className="cell-hero" variants={section} custom={i++}>
            <Silhouette cell={cell} />
            <div className="hero-text">
              <span className="terrain-chip"><i style={{ background: terrainColors[cell.terrain] }} />{t(`terrain.${cell.terrain}`)}</span>
              <h3>{t('inspector.cell', { value: number(cell.id + 1) })}</h3>
              <p>{t(locationKey(cell))} · {latText}</p>
              <p className="mono">{t('inspector.position', { x: number(cell.centroid.x), y: number(cell.centroid.y) })}</p>
            </div>
            <button type="button" className="focus-button" onClick={() => onFocus(cell.id)} aria-label={t('inspector.focus')} data-tip={t('inspector.focus')}>
              <Icon name="target" size={18} />
            </button>
          </motion.header>

          <motion.div className="metric-grid" variants={section} custom={i++}>
            {metrics.map(([label, value, format]) => (
              <div key={label} className="metric"><span>{label}</span><strong><AnimatedNumber value={value} format={format} /></strong></div>
            ))}
          </motion.div>
          {hasLand && <motion.p className="note" variants={section} custom={i++}>{t('inspector.meansNote')}</motion.p>}

          {hasLand ? <>
            <motion.section className="block" variants={section} custom={i++}>
              <h4>{t('inspector.components')}</h4>
              <div className="chips">
                <span>{t(`landform.${cell.landform}`)}</span>
                <span>{t(`thermal.${cell.thermal_zone}`)} · {t(`moisture.${cell.moisture_zone}`)}</span>
                <span>{t(`vegetation.${cell.vegetation}`)}</span>
              </div>
            </motion.section>

            <motion.section className="block" variants={section} custom={i++}>
              <h4>{t('inspector.indices')}</h4>
              <div className="gauges">
                <Gauge value={cell.flatness} label={t('inspector.flatness')} hue="#8fd3e8" />
                <Gauge value={cell.soil_quality} label={t('inspector.fertility')} hue="#e0b36a" />
                <Gauge value={cell.agricultural_suitability} label={t('inspector.agriculture')} hue="#a6e36a" />
                <Gauge value={cell.irrigation_potential} label={t('inspector.irrigation')} hue="#5fd0ff" />
              </div>
              <div className="arable">
                <div className="arable-head"><span>{t('inspector.arable')}</span><strong>{percent(cell.arable_fraction, 1)}</strong></div>
                <div className="bar"><motion.span initial={{ width: 0 }} animate={{ width: `${cell.arable_fraction * 100}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} /></div>
              </div>
              <p className="note">{t('inspector.agricultureNote')}</p>
            </motion.section>

            {cell.causes.length > 0 && (
              <motion.section className="block" variants={section} custom={i++}>
                <h4>{t('inspector.explanation')}</h4>
                <ul className="causes">{cell.causes.map((cause) => <li key={cause}><Icon name="sparkle" size={13} />{t(`cause.${cause}`)}</li>)}</ul>
              </motion.section>
            )}

            <motion.section className="block" variants={section} custom={i++}>
              <h4>{t('climate.title')}</h4>
              <div className="climate-summary">
                <div><span>{t('climate.growing')}</span><strong>{t('climate.monthCount', { value: number(cell.climate.growing_months, 1) })}</strong></div>
                <div><span>{t('climate.rainfed')}</span><strong>{t('climate.monthCount', { value: number(cell.climate.rainfed_months, 1) })}</strong></div>
              </div>
              <ClimateChart profile={cell.climate} month={month} onMonth={onMonth} />
              <details className="climate-table-wrap">
                <summary>{t('climate.showTable')}</summary>
                <table className="climate-table">
                  <caption>{t('climate.tableCaption')}</caption>
                  <thead><tr><th>{t('climate.monthHeader')}</th><th>{t('climate.temperatureHeader')}</th><th>{t('climate.precipitationHeader')}</th><th>{t('climate.snowmeltHeader')}</th><th>{t('climate.runoffHeader')}</th></tr></thead>
                  <tbody>{cell.climate.months.map((m, index) => (
                    <tr key={index} className={index === month ? 'selected-month' : undefined}>
                      <th scope="row">{t('climate.month', { value: index + 1 })}</th><td>{number(m.temperature_c, 1)}</td><td>{number(m.precipitation_mm)}</td><td>{number(m.snowmelt_mm)}</td><td>{number(m.runoff_mm)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </details>
              <p className="note">{t('climate.waterNote')}</p>
            </motion.section>

            <motion.section className="block" variants={section} custom={i++}>
              <h4>{t('inspector.resources')}</h4>
              <ResourceRadar resources={cell.resources} active={layer === 'resources' ? resource : undefined} onPick={onResource} />
              <div className="resource-list">
                {[...cell.resources].sort((a, b) => b.potential - a.potential).map((r) => (
                  <button key={r.kind} type="button" className={`resource-row${layer === 'resources' && resource === r.kind ? ' active' : ''}`} onClick={() => onResource(r.kind)}>
                    <span>{t(`resource.${r.kind}`)}</span>
                    <span className="track"><motion.i initial={{ width: 0 }} animate={{ width: `${r.potential}%` }} transition={{ duration: 0.7, ease: 'easeOut' }} /></span>
                    <strong>{number(r.potential)}</strong>
                  </button>
                ))}
              </div>
              <p className="note">{t('inspector.resourceHint')} · {t('inspector.resourcesNote')}</p>
            </motion.section>
          </> : (
            <motion.div className="sea-note" variants={section} custom={i++}><Icon name="drop" size={20} /><p>{t('inspector.seaNote')}</p></motion.div>
          )}

          <motion.section className="block" variants={section} custom={i++}>
            <div className="block-head"><h4>{t('inspector.neighbors')}</h4><span>{t('inspector.neighborCount', { value: number(cell.neighbors.length) })}</span></div>
            <div className="neighbors" onPointerLeave={() => onPreview(undefined)}>
              {cell.neighbors.map((id) => {
                const n = world.cells[id];
                return (
                  <button key={id} type="button" className="neighbor" onPointerEnter={() => onPreview(id)} onFocus={() => onPreview(id)} onBlur={() => onPreview(undefined)}
                    onClick={() => { onPreview(undefined); onFocus(id, false); }} title={`${t('inspector.cell', { value: id + 1 })} · ${t(`terrain.${n.terrain}`)}`}>
                    <i style={{ background: terrainColors[n.terrain] }} />{number(id + 1)}<Icon name="chevron" size={12} />
                  </button>
                );
              })}
            </div>
            <p className="note">{t('inspector.adjacencyNote')}</p>
          </motion.section>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
