import { number, percent, t } from '../i18n';
import type { Cell, ResourceKind, WorldMap } from '../types';

export function GeographyPanel({ cell }: { cell: Cell }) {
  const g = cell.geography, h = g.land_elevation_m;
  return <>
    <h4>{t('geo.title')}</h4>
    <div className="climate-summary water-metrics">
      {(['area_km2', 'dry_land_area_km2', 'lake_area_km2', 'ocean_area_km2'] as const).map(key =>
        <div key={key}><span>{t(`geo.${key}`)}</span><strong>{t('land.km2', { value: number(g[key]) })}</strong></div>)}
      {h && <>
        <div><span>{t('geo.landMean')}</span><strong>{t('unit.m', { value: number(h.mean) })}</strong></div>
        <div><span>{t('geo.landRange')}</span><strong>{number(h.min)}—{t('unit.m', { value: number(h.max) })}</strong></div>
      </>}
    </div>
    <p className="note">{t('geo.note')}</p>
  </>;
}

export function OceanPanel({ cell, month, onMonth }: { cell: Cell; month?: number; onMonth: (month: number) => void }) {
  const sea = cell.ocean;
  if (!sea) return null;
  const mean = (values: number[]) => month === undefined ? values.reduce((sum, v) => sum + v, 0) / values.length : values[month];
  const directions = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
  const bearing = (Math.atan2(sea.current_east, sea.current_north) * 180 / Math.PI + 360) % 360;
  const direction = Math.hypot(sea.current_east, sea.current_north) < 0.04 ? 'variable' : directions[Math.round(bearing / 45) % 8];
  const anomaly = mean(sea.temperature_anomaly_c);
  return <>
    <h4>{t('ocean.title')}</h4>
    <div className="chips"><span>{month === undefined ? t('climate.annual') : t('climate.month', { value: month + 1 })}</span>
      <span>{t(`ocean.direction.${direction}`)}</span></div>
    <div className="climate-summary water-metrics">
      <div><span>{t('ocean.surfaceTemperature')}</span><strong>{t('unit.celsius', { value: number(mean(sea.surface_temperature_c), 1) })}</strong></div>
      <div><span>{t('ocean.anomaly')}</span><strong>{anomaly > 0 ? '+' : ''}{t('unit.celsius', { value: number(anomaly, 1) })}</strong></div>
      <div><span>{t('ocean.strength')}</span><strong>{number(sea.current_strength * 100)}</strong></div>
    </div>
    <p className="note">{t('ocean.note')}</p>
    <details className="climate-table-wrap"><summary>{t('ocean.months')}</summary>
      <table className="climate-table"><thead><tr><th>{t('climate.monthHeader')}</th><th>{t('ocean.surfaceTemperature')}</th><th>{t('ocean.anomaly')}</th></tr></thead>
        <tbody>{sea.surface_temperature_c.map((v, m) => <tr key={m} className={month === m ? 'selected-month' : undefined}>
          <th scope="row"><button className="water-month" type="button" onClick={() => onMonth(m)}>{t('climate.month', { value: m + 1 })}</button></th>
          <td>{number(v, 1)}</td><td>{number(sea.temperature_anomaly_c[m], 1)}</td>
        </tr>)}</tbody>
      </table>
    </details>
  </>;
}

export function GeologyPanel({ cell, world, onResource }: { cell: Cell; world: WorldMap; onResource: (kind: ResourceKind) => void }) {
  return <>
    <h4>{t('geology.title')}</h4>
    <div className="chips">{cell.geology_provinces.map(id => {
      const province = world.environment.geology_provinces[id];
      return <span key={id}>{t('geology.region', { value: province.tectonic_region_id + 1 })} · {t(`geology.kind.${province.kind}`)} · {t(`geology.rock.${province.rock}`)}</span>;
    })}</div>
    <p className="note">{t('geology.structureNote')}</p>
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
