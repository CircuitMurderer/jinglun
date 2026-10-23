import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { number, t } from '../i18n';
import type { ClimateProfile, Resource, ResourceKind } from '../types';

/* ---------- Monthly climate: precipitation bars + temperature line ---------- */
export function ClimateChart({ profile, month, onMonth }: { profile: ClimateProfile; month?: number; onMonth: (month: number) => void }) {
  const [hover, setHover] = useState<number>();
  const W = 336, H = 168, L = 30, R = 36, T = 14, B = 22;
  const pw = W - L - R, ph = H - T - B, bw = pw / 12;
  const geometry = useMemo(() => {
    const precip = profile.months.map((m) => m.precipitation_mm);
    const temps = profile.months.map((m) => m.temperature_c);
    const pMax = Math.max(60, ...precip) * 1.12;
    let tMin = Math.min(...temps) - 3, tMax = Math.max(...temps) + 3;
    if (tMax - tMin < 12) { const mid = (tMax + tMin) / 2; tMin = mid - 6; tMax = mid + 6; }
    const ty = (v: number) => T + (1 - (v - tMin) / (tMax - tMin)) * ph;
    const py = (v: number) => T + (1 - v / pMax) * ph;
    const cx = (i: number) => L + bw * (i + 0.5);
    const line = temps.map((v, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${ty(v).toFixed(1)}`).join(' ');
    const area = `${line} L${cx(11).toFixed(1)},${T + ph} L${cx(0).toFixed(1)},${T + ph} Z`;
    return { pMax, tMin, tMax, ty, py, cx, line, area };
  }, [profile, ph, bw]);
  const { pMax, tMin, tMax, ty, py, cx, line, area } = geometry;
  const focus = hover ?? month;
  const m = focus === undefined ? undefined : profile.months[focus];
  return (
    <div className="climate-chart">
      <div className="chart-readout">
        {m ? <>
          <b>{t('climate.month', { value: focus! + 1 })}</b>
          <span className="warm">{t('unit.celsius', { value: number(m.temperature_c, 1) })}</span>
          <span className="wet">{t('climate.precipitationHeader')} {number(m.precipitation_mm)}</span>
          <span>{t('climate.snowmeltHeader')} {number(m.snowmelt_mm)}</span>
          <span>{t('climate.runoffHeader')} {number(m.runoff_mm)}</span>
        </> : <span className="muted">{t('climate.clickHint')}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('climate.chart')} onPointerLeave={() => setHover(undefined)}>
        <defs>
          <linearGradient id="bar-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent-cyan)" stopOpacity="0.95" /><stop offset="1" stopColor="#2f6fd0" stopOpacity="0.35" /></linearGradient>
          <linearGradient id="temp-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent-coral)" /><stop offset="1" stopColor="var(--chart-gold)" /></linearGradient>
          <linearGradient id="temp-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffb35c" stopOpacity="0.22" /><stop offset="1" stopColor="#ffb35c" stopOpacity="0" /></linearGradient>
        </defs>
        {[0, 0.5, 1].map((k) => <line key={k} className="grid-line" x1={L} x2={W - R} y1={T + ph * k} y2={T + ph * k} />)}
        {month !== undefined && <rect className="month-highlight" x={L + bw * month} y={T - 6} width={bw} height={ph + 6} rx={4} />}
        {tMin < 0 && tMax > 0 && <line className="freeze-line" x1={L} x2={W - R} y1={ty(0)} y2={ty(0)} />}
        {profile.months.map((mo, i) => (
          <g key={i}>
            <motion.rect className="precip-bar" x={L + bw * i + bw * 0.2} width={bw * 0.6} rx={2}
              initial={false} animate={{ y: py(mo.precipitation_mm), height: Math.max(0.5, T + ph - py(mo.precipitation_mm)) }} transition={{ duration: 0.6, delay: i * 0.025, ease: 'easeOut' }} />
            {mo.snowmelt_mm > 0.5 && <motion.rect className="melt-bar" x={L + bw * i + bw * 0.42} width={bw * 0.16}
              initial={false} animate={{ y: py(mo.snowmelt_mm), height: Math.max(0.5, T + ph - py(mo.snowmelt_mm)) }} transition={{ duration: 0.6, delay: i * 0.025 }} />}
          </g>
        ))}
        <motion.path className="temp-area" d={area} initial={false} animate={{ d: area }} transition={{ duration: 0.6 }} />
        <motion.path className="temp-line" d={line} initial={false} animate={{ d: line }} transition={{ duration: 0.6 }} />
        {profile.months.map((mo, i) => (
          <motion.circle key={i} className={`temp-dot${i === focus ? ' focus' : ''}`} cx={cx(i)} r={i === focus ? 3.6 : 2.2}
            initial={false} animate={{ cy: ty(mo.temperature_c) }} transition={{ duration: 0.6 }} />
        ))}
        <text className="axis warm" x={L - 6} y={T + 4} textAnchor="end">{number(tMax, 0)}°</text>
        <text className="axis warm" x={L - 6} y={T + ph} textAnchor="end">{number(tMin, 0)}°</text>
        <text className="axis wet" x={W - R + 6} y={T + 4}>{number(pMax, 0)}</text>
        <text className="axis wet" x={W - R + 6} y={T + ph}>0</text>
        {profile.months.map((_, i) => <text key={i} className={`axis month${i === focus ? ' focus' : ''}`} x={cx(i)} y={H - 6} textAnchor="middle">{i + 1}</text>)}
        {profile.months.map((_, i) => (
          <rect key={i} className="hit" x={L + bw * i} y={0} width={bw} height={H} onPointerEnter={() => setHover(i)} onClick={() => onMonth(i)}>
            <title>{t('climate.month', { value: i + 1 })}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}

/* ---------- Ten-axis resource radar ---------- */
export function ResourceRadar({ resources, active, onPick }: { resources: Resource[]; active?: ResourceKind; onPick: (kind: ResourceKind) => void }) {
  const W = 300, H = 236, cx = W / 2, cy = H / 2 + 2, R = 80;
  const n = resources.length;
  const at = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
  };
  const shape = resources.map((res, i) => at(i, Math.max(3, (res.potential / 100) * R)));
  const d = `${shape.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} Z`;
  return (
    <svg className="radar" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('inspector.radar')}>
      <defs>
        <radialGradient id="radar-fill"><stop offset="0" stopColor="var(--chart-gold)" stopOpacity="0.15" /><stop offset="1" stopColor="#e0559f" stopOpacity="0.45" /></radialGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon key={k} className="radar-ring" points={resources.map((_, i) => at(i, R * k).join(',')).join(' ')} />
      ))}
      {resources.map((_, i) => { const [x, y] = at(i, R); return <line key={i} className="radar-spoke" x1={cx} y1={cy} x2={x} y2={y} />; })}
      <motion.path className="radar-shape" d={d} initial={false} animate={{ d }} transition={{ type: 'spring', stiffness: 120, damping: 18 }} />
      {resources.map((res, i) => {
        const [x, y] = shape[i];
        return <motion.circle key={res.kind} className={`radar-dot${res.kind === active ? ' active' : ''}`} r={res.kind === active ? 4 : 2.4} initial={false} animate={{ cx: x, cy: y }} transition={{ type: 'spring', stiffness: 120, damping: 18 }} />;
      })}
      {resources.map((res, i) => {
        const [x, y] = at(i, R + 20);
        return (
          <g key={res.kind} className={`radar-label${res.kind === active ? ' active' : ''}`} onClick={() => onPick(res.kind)} role="button" tabIndex={-1}>
            <text x={x} y={y - 2} textAnchor="middle">{t(`resource.${res.kind}`)}</text>
            <text x={x} y={y + 10} textAnchor="middle" className="radar-num">{number(res.potential)}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- Ring gauge ---------- */
export function Gauge({ value, label, hue }: { value: number; label: string; hue: string }) {
  const r = 22, c = 2 * Math.PI * r;
  return (
    <div className="gauge">
      <svg viewBox="0 0 56 56" width="56" height="56" aria-hidden="true">
        <circle cx="28" cy="28" r={r} className="gauge-bg" />
        <motion.circle cx="28" cy="28" r={r} className="gauge-fg" stroke={hue} strokeDasharray={c} initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(100, value)) / 100) }} transition={{ duration: 0.9, ease: 'easeOut' }}
          style={{ filter: `drop-shadow(0 0 4px ${hue})` }} />
        <text x="28" y="32" textAnchor="middle">{number(value)}</text>
      </svg>
      <span>{label}</span>
    </div>
  );
}
