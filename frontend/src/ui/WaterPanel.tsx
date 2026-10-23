import { number, t } from '../i18n';
import type { Cell, WorldMap } from '../types';

export function WaterPanel({ cell, world, month, onMonth }: {
  cell: Cell; world: WorldMap; month?: number; onMonth: (month: number) => void;
}) {
  const period = month === undefined ? cell.groundwater.months : [cell.groundwater.months[month]];
  const storage = period.reduce((sum, m) => sum + m.storage_mm, 0) / period.length;
  const baseflow = period.reduce((sum, m) => sum + m.baseflow_mm, 0);
  const sources = world.environment.water_sources.filter(s => cell.water_source_ids.includes(s.id))
    .sort((a, b) => b.months.reduce((s, m) => s + m.freshwater_ceiling, 0) - a.months.reduce((s, m) => s + m.freshwater_ceiling, 0));
  const sourceNumbers = new Map(world.environment.water_sources.map((s, index) => [s.id, index + 1]));
  const volume = (value: number) => number(value * world.environment.scale.water_unit_m3 / 1_000_000, 1);
  return <>
    <h4>{t('water.title')}</h4>
    <div className="chips"><span>{month === undefined ? t('climate.annual') : t('climate.month', { value: month + 1 })}</span></div>
    <div className="climate-summary water-metrics">
      <div><span>{t(month === undefined ? 'water.groundStorage' : 'water.groundMonthStorage')}</span><strong>{t('unit.mm', { value: number(storage, 1) })}</strong></div>
      <div><span>{t('water.baseflow')}</span><strong>{t('unit.mm', { value: number(baseflow, 1) })}</strong></div>
    </div>
    <p className="note">{t('water.groundNote')}</p>
    <details className="climate-table-wrap"><summary>{t('water.groundTable')}</summary>
      <table className="climate-table"><caption>{t('water.groundUnits')}</caption>
        <thead><tr><th>{t('climate.monthHeader')}</th><th>{t('water.recharge')}</th><th>{t('water.seepage')}</th><th>{t('water.baseflowShort')}</th><th>{t('water.storageShort')}</th><th>{t('water.tds')}</th></tr></thead>
        <tbody>{cell.groundwater.months.map((m, index) => <tr key={index} className={index === month ? 'selected-month' : undefined}>
          <th scope="row"><button type="button" className="water-month" onClick={() => onMonth(index)} aria-label={t('water.pickMonth', { value: index + 1 })}>{t('climate.month', { value: index + 1 })}</button></th>
          <td>{number(m.recharge_mm, 1)}</td><td>{number(m.seepage_mm, 1)}</td><td>{number(m.baseflow_mm, 1)}</td><td>{number(m.storage_mm, 1)}</td><td>{m.storage_mm > 1e-8 ? number(m.tds_mg_l) : '—'}</td>
        </tr>)}</tbody>
      </table>
    </details>
    <p className="note">{t('water.sharedNote')}</p>
    <p className="note">{t('water.planningUnits')}</p>
    <details className="climate-table-wrap water-sources" open={sources.length === 1}>
      <summary>{t('water.sources', { value: sources.length })}</summary>
      {sources.map(source => {
        const months = month === undefined ? source.months : [source.months[month]];
        const ceiling = months.reduce((sum, m) => sum + m.freshwater_ceiling, 0);
        const reserve = months.reduce((sum, m) => sum + m.ecological_reserve, 0);
        return <div className="lake-card" key={source.id}>
          <div className="chips"><span>{t('water.source', { value: sourceNumbers.get(source.id)! })}</span><span>{t(`water.outlet.${source.outlet}`)}</span>
            <span>{month === undefined ? t('water.freshMonths', { value: source.months.filter(m => m.quality === 'fresh').length }) : t(`water.quality.${source.months[month].quality}`)}</span></div>
          <div className="climate-summary water-metrics">
            <div><span>{t('water.freshCeiling')}</span><strong>{volume(ceiling)}</strong></div>
            <div><span>{t('water.reserve')}</span><strong>{volume(reserve)}</strong></div>
          </div>
          <details className="climate-table-wrap"><summary>{t('water.sourceTable')}</summary>
            <table className="climate-table"><caption>{t('water.sourceUnits')}</caption>
              <thead><tr><th>{t('climate.monthHeader')}</th><th>{t('water.freshCeiling')}</th><th>{t('water.tds')}</th><th>{t('water.quality')}</th></tr></thead>
              <tbody>{source.months.map((m, index) => <tr key={index} className={index === month ? 'selected-month' : undefined}>
                <th scope="row">{t('climate.month', { value: index + 1 })}</th><td>{volume(m.freshwater_ceiling)}</td><td>{m.quality === 'dry' ? '—' : number(m.tds_mg_l)}</td><td>{t(`water.quality.${m.quality}`)}</td>
              </tr>)}</tbody>
            </table>
          </details>
        </div>;
      })}
    </details>
    <p className="note">{t('water.qualityNote')}</p>
  </>;
}
