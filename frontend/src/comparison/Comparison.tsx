import { useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import { number, percent, t } from '../i18n';
import type { Cell, WorldMap } from '../types';
import { initialPins, projectComparison, reducePins } from './model';
import './comparison.css';

type Props = { world?: WorldMap; selectedId?: number; month?: number; onPeriod: (month?: number) => void; onInspect: (id: number) => void };
type Candidate = ReturnType<typeof projectComparison>['candidates'][number];
type Row = readonly [string, (candidate: Candidate) => ReactNode];
const unavailable = () => t('comparison.na');
const numeric = (value: number | null | undefined, decimals = 1) => value === null || value === undefined || !Number.isFinite(value) ? unavailable() : number(value, decimals);
const land = (candidate: Candidate, read: (cell: Cell) => ReactNode) => candidate.cell.land_fraction > 0 ? read(candidate.cell) : unavailable();
const cellName = (id: number) => t('inspector.cell', { value: id + 1 });

export function Comparison({ world, selectedId, month, onPeriod, onInspect }: Props) {
  const [state, dispatch] = useReducer(reducePins, initialPins);
  const addRef = useRef<HTMLButtonElement>(null);
  const removeRefs = useRef(new Map<number, HTMLButtonElement>());
  const selectedExists = world?.cells.some(cell => cell.id === selectedId) ?? false;
  const reason = !selectedExists ? 'comparison.choose' : state.ids.includes(selectedId!) ? 'comparison.duplicate' : state.ids.length >= 4 ? 'comparison.limit' : undefined;
  const view = world ? projectComparison(world, state.ids, month) : { candidates: [], sources: [] };
  const remove = (id: number) => {
    const index = state.ids.indexOf(id);
    const next = state.ids[index + 1] ?? state.ids[index - 1];
    dispatch({ type: 'remove', id });
    if (next !== undefined) removeRefs.current.get(next)?.focus();
    else requestAnimationFrame(() => addRef.current?.focus());
  };
  const tables: readonly [string, readonly Row[]][] = [
    [t('comparison.natural'), [
      [t('comparison.terrain'), ({ cell }) => t(`terrain.${cell.terrain}`)],
      [t('inspector.elevation'), ({ cell }) => t('unit.m', { value: numeric(cell.elevation_m) })],
      [t('inspector.landFraction'), ({ cell }) => percent(cell.land_fraction, 1)],
      [t(month === undefined ? 'inspector.temperature' : 'comparison.temperature'), c => numeric(c.temperature) + ' °C'],
      [t(month === undefined ? 'inspector.rainfall' : 'comparison.precipitation'), c => numeric(c.precipitation) + ' mm'],
      [t(month === undefined ? 'water.groundStorage' : 'water.groundMonthStorage'), c => c.storage === null ? unavailable() : numeric(c.storage) + ' mm'],
      [t('water.baseflow'), c => c.baseflow === null ? unavailable() : numeric(c.baseflow) + ' mm'],
    ]],
    [t('comparison.land'), [
      [t('land.area'), c => land(c, cell => t('land.km2', { value: numeric(cell.construction.area_km2) }))],
      [t('land.buildableArea'), c => land(c, cell => t('land.km2', { value: numeric(cell.construction.buildable_area_km2) }))],
      [t('land.buildable'), c => land(c, cell => percent(cell.construction.buildable_fraction, 1))],
      [t('land.cost'), c => land(c, cell => cell.construction.cost_multiplier === null ? unavailable() : t('land.multiplier', { value: numeric(cell.construction.cost_multiplier, 2) }))],
      [t('land.flood'), c => land(c, cell => numeric(cell.construction.flood_risk))],
      [t('land.months'), c => land(c, cell => numeric(cell.construction.construction_months))],
      [t('inspector.agriculture'), c => land(c, cell => numeric(cell.agricultural_suitability))],
      [t('inspector.arable'), c => land(c, cell => percent(cell.arable_fraction, 1))],
      [t('inspector.irrigation'), c => land(c, cell => numeric(cell.irrigation_potential))],
      [t('climate.growing'), c => land(c, cell => t('climate.monthCount', { value: numeric(cell.climate.growing_months) }))],
    ]],
    [t('comparison.resources'), (['grain', 'livestock', 'fiber', 'timber', 'stone', 'coal', 'iron', 'oil', 'rare_earth', 'freshwater'] as const).map(kind => [t(`resource.${kind}`), c => land(c, cell => numeric(cell.resources.find(resource => resource.kind === kind)?.potential))])],
    [t('comparison.minerals'), [[t('geology.title'), c => land(c, cell => cell.minerals.length ? cell.minerals.map(mineral => <p key={mineral.deposit_id}>
      {t(`resource.${mineral.kind}`)} · {t('geology.deposit', { value: mineral.deposit_id + 1 })}<br />
      {t('geology.reserve')} {numeric(mineral.reserve_units)}<br />
      {t('geology.grade')} {numeric(mineral.grade_index)} · {t('geology.depth')} {numeric(mineral.depth_m)} m<br />
      {t('geology.difficulty')} {numeric(mineral.extraction_difficulty)}
    </p>) : t('geology.noDeposit'))]]],
  ];
  return <section className="comparison" aria-label={t('comparison.title')}>
    <div className="comparison-controls">
      <strong>{t('comparison.count', { value: state.ids.length })}</strong>
      <button type="button" ref={addRef} aria-describedby="comparison-pin-help" disabled={!!reason} onClick={() => {
        if (selectedExists && selectedId !== undefined) dispatch({ type: 'pin', id: selectedId });
      }}>{t('comparison.add')}</button>
      <button type="button" disabled={!state.ids.length} onClick={() => { dispatch({ type: 'clear' }); requestAnimationFrame(() => addRef.current?.focus()); }}>{t('comparison.clear')}</button>
    </div>
    <p className="note" id="comparison-pin-help">{reason ? t(reason) : t('comparison.ready')}</p>
    <p className="note" role="status">{state.feedback ? t(`comparison.${state.feedback}`) : ''}</p>
    <details>
      <summary>{t('comparison.title')}</summary>
      {state.ids.length < 2 && <p className="note">{t(state.ids.length ? 'comparison.one' : 'comparison.empty')}</p>}
      {state.ids.map(id => <div className="comparison-candidate" key={id}>
        <button type="button" onClick={() => onInspect(id)}>{t('comparison.inspect', { cell: cellName(id) })}</button>
        <button type="button" ref={element => { if (element) removeRefs.current.set(id, element); else removeRefs.current.delete(id); }} onClick={() => remove(id)}>{t('comparison.remove', { cell: cellName(id) })}</button>
      </div>)}
      {!!state.ids.length && <>
        <label>{t('comparison.period')} <select value={month ?? 'annual'} onChange={event => onPeriod(event.target.value === 'annual' ? undefined : Number(event.target.value))}>
          <option value="annual">{t('climate.annual')}</option>
          {Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{t('climate.month', { value: i + 1 })}</option>)}
        </select></label>
        <p className="note">{t('comparison.staticNote')}</p>
        {tables.map(([title, rows]) => <div key={title} className="comparison-scroll" tabIndex={0} role="region" aria-label={title} onKeyDown={event => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) event.stopPropagation();
        }}>
          <table><caption>{title} · {month === undefined ? t('climate.annual') : t('climate.month', { value: month + 1 })}</caption>
            <thead><tr><th scope="col">{t('comparison.metric')}</th>{view.candidates.map(({ cell }) => <th scope="col" key={cell.id}>{cellName(cell.id)}</th>)}</tr></thead>
            <tbody>{rows.map(([label, read]) => <tr key={label}><th scope="row">{label}</th>{view.candidates.map(candidate => <td key={candidate.cell.id}>{read(candidate)}</td>)}</tr>)}</tbody>
          </table>
        </div>)}
        <h4>{t('comparison.water')}</h4>
        <p className="note">{t('water.sharedNote')} {t('water.planningUnits')}</p>
        {!view.sources.length && <p className="note">{t('comparison.noSources')}</p>}
        {view.sources.map(source => <div className="lake-card" key={source.id}>
          <h5>{t('water.source', { value: source.number })} · {t(`water.outlet.${source.outlet}`)}</h5>
          <p>{t('comparison.members')} {source.members.map(cellName).join('、')}</p>
          <p>{t('water.freshCeiling')} {numeric(source.ceiling)} · {t('water.reserve')} {numeric(source.reserve)}</p>
          <p>{t('water.quality')} {source.qualities.map(quality => t(`water.quality.${quality}`)).join('、') || unavailable()}</p>
        </div>)}
      </>}
    </details>
  </section>;
}
