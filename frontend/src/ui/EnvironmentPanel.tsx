import { number, percent, t } from '../i18n';
import type { Cell, ResourceKind, WorldMap } from '../types';

export function GeologyPanel({ cell, world, onResource }: { cell: Cell; world: WorldMap; onResource: (kind: ResourceKind) => void }) {
  return <>
    <h4>{t('geology.title')}</h4>
    <div className="chips">{cell.geology_provinces.map(id => {
      const province = world.environment.geology_provinces[id];
      return <span key={id}>{t(`geology.kind.${province.kind}`)} · {t(`geology.rock.${province.rock}`)}</span>;
    })}</div>
    <p className="note">{t('geology.note')}</p>
    {cell.minerals.map(m => <details className="climate-table-wrap mineral-card" key={m.deposit_id}>
      <summary>{t(`resource.${m.kind}`)} · {t('geology.deposit', { value: m.deposit_id + 1 })}</summary>
      <div className="climate-summary water-metrics">
        <div><span>{t('geology.reserve')}</span><strong>{number(m.reserve_units)}</strong></div>
        <div><span>{t('geology.grade')}</span><strong>{number(m.grade_index)}</strong></div>
        <div><span>{t('geology.depth')}</span><strong>{t('unit.m', { value: number(m.depth_m) })}</strong></div>
        <div><span>{t('geology.difficulty')}</span><strong>{number(m.extraction_difficulty)}</strong></div>
      </div>
      <button type="button" className="water-month" onClick={() => onResource(m.kind)}>{t('geology.showResource', { value: t(`resource.${m.kind}`) })}</button>
    </details>)}
    {!cell.minerals.length && <p className="note">{t('geology.noDeposit')}</p>}
  </>;
}

export function SoilPanel({ cell }: { cell: Cell }) {
  const s = cell.soil_profile;
  return <>
    <h4>{t('soil.title')}</h4>
    <div className="climate-summary water-metrics">
      <div><span>{t('soil.depth')}</span><strong>{t('soil.cm', { value: number(s.depth_cm, 1) })}</strong></div>
      <div><span>{t('soil.organic')}</span><strong>{percent(s.organic_percent / 100, 1)}</strong></div>
      <div><span>{t('soil.sand')}</span><strong>{percent(s.sand_fraction)}</strong></div>
      <div><span>{t('soil.capacity')}</span><strong>{t('unit.mm', { value: number(s.water_capacity_mm) })}</strong></div>
      <div><span>{t('soil.erosion')}</span><strong>{t('soil.mmYear', { value: number(s.erosion_mm_year, 2) })}</strong></div>
      <div><span>{t('soil.deposition')}</span><strong>{t('soil.mmYear', { value: number(s.deposition_mm_year, 2) })}</strong></div>
    </div>
    <p className="note">{t('soil.note')}</p>
  </>;
}

export function ConstructionPanel({ cell, world, onFocus }: { cell: Cell; world: WorldMap; onFocus: (id: number, zoom?: boolean) => void }) {
  const c = cell.construction;
  const edges = world.edges.filter(e => e.a === cell.id || e.b === cell.id);
  return <>
    <h4>{t('land.title')}</h4>
    <div className="climate-summary water-metrics">
      <div><span>{t('land.area')}</span><strong>{t('land.km2', { value: number(c.area_km2) })}</strong></div>
      <div><span>{t('land.buildableArea')}</span><strong>{t('land.km2', { value: number(c.buildable_area_km2) })}</strong></div>
      <div><span>{t('land.buildable')}</span><strong>{percent(c.buildable_fraction, 1)}</strong></div>
      <div><span>{t('land.conditional')}</span><strong>{percent(c.conditional_fraction, 1)}</strong></div>
      <div><span>{t('land.cost')}</span><strong>{c.cost_multiplier === null ? '—' : t('land.multiplier', { value: number(c.cost_multiplier, 2) })}</strong></div>
      <div><span>{t('land.months')}</span><strong>{t('climate.monthCount', { value: number(c.construction_months, 1) })}</strong></div>
      <div><span>{t('land.flood')}</span><strong>{number(c.flood_risk)}</strong></div>
      <div><span>{t('land.support')}</span><strong>{number(c.natural_support_index)}</strong></div>
    </div>
    <p className="note">{t('land.note')}</p>
    <details className="climate-table-wrap"><summary>{t('land.corridors')}</summary>
      <div className="natural-corridors">{edges.map(e => {
        const next = e.a === cell.id ? e.b : e.a;
        return <button type="button" key={e.id} onClick={() => onFocus(next, false)}>
          <span>{t('inspector.cell', { value: next + 1 })}</span><span>{t(`land.passage.${e.passage.kind}`)}{e.passage.crosses_river && e.passage.kind !== 'river_crossing' ? ` · ${t('land.passage.river_crossing')}` : ''}</span>
          <span>{t('land.km', { value: number(e.passage.distance_km) })}</span>
        </button>;
      })}</div>
      <p className="note">{t('land.corridorNote')}</p>
    </details>
  </>;
}
