import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { number, t } from '../i18n';
import { terrainColor } from '../map';
import type { Layer, WorldMap } from '../types';
import { Icon } from './Icon';
import { layers, locationKey } from './shared';

type Item = { kind: 'layer'; id: Layer; index: number } | { kind: 'cell'; id: number };

interface Props {
  open: boolean;
  world?: WorldMap;
  onClose: () => void;
  onCell: (id: number) => void;
  onLayer: (layer: Layer) => void;
  onPreview: (id?: number) => void;
}

export function CommandPalette({ open, world, onClose, onCell, onLayer, onPreview }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { setQuery(''); setActive(0); requestAnimationFrame(() => input.current?.focus()); } else onPreview(undefined); }, [open, onPreview]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const layerItems: Item[] = layers.map((l, index) => ({ kind: 'layer' as const, id: l.id, index }))
      .filter((l) => q && t(`layer.${l.id}`).toLowerCase().includes(q));
    if (!world) return layerItems;
    const digits = q.replace(/[^\d]/g, '');
    const cells = world.cells.filter((cell) => {
      if (!q) return cell.is_land;
      if (digits && /^\d+$/.test(q)) return String(cell.id + 1).startsWith(digits);
      const text = `${t(`terrain.${cell.terrain}`)} ${t(locationKey(cell))} ${t(`landform.${cell.landform}`)} ${t(`vegetation.${cell.vegetation}`)} ${t(`moisture.${cell.moisture_zone}`)}`;
      return text.toLowerCase().includes(q);
    }).slice(0, 60).map((cell) => ({ kind: 'cell' as const, id: cell.id }));
    return [...layerItems, ...cells];
  }, [query, world]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    if (!open) return;
    const item = items[active];
    onPreview(item?.kind === 'cell' ? item.id : undefined);
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, items, onPreview]);

  const choose = (item?: Item) => {
    if (!item) return;
    if (item.kind === 'cell') onCell(item.id); else onLayer(item.id);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div className="palette glass" role="dialog" aria-modal="true" aria-label={t('palette.open')}
            initial={{ opacity: 0, y: -24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }} onMouseDown={(event) => event.stopPropagation()}>
            <div className="palette-input">
              <Icon name="search" size={18} />
              <input ref={input} value={query} placeholder={t('palette.placeholder')} onChange={(event) => setQuery(event.target.value)}
                aria-label={t('palette.placeholder')} role="combobox" aria-expanded="true" aria-controls="palette-list"
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') { event.preventDefault(); setActive((v) => Math.min(items.length - 1, v + 1)); }
                  else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((v) => Math.max(0, v - 1)); }
                  else if (event.key === 'Enter') { event.preventDefault(); choose(items[active]); }
                  else if (event.key === 'Escape') { event.preventDefault(); onClose(); }
                }} />
              <kbd>Esc</kbd>
            </div>
            <div className="palette-list" id="palette-list" role="listbox" ref={list}>
              {items.length === 0 && <div className="palette-empty">{t('palette.empty')}</div>}
              {items.map((item, index) => {
                const selected = index === active;
                const common = { 'data-index': index, role: 'option', 'aria-selected': selected, className: `palette-item${selected ? ' active' : ''}`, onMouseEnter: () => setActive(index), onClick: () => choose(item) };
                if (item.kind === 'layer') {
                  return (
                    <div key={`l-${item.id}`} {...common}>
                      <span className="palette-icon"><Icon name={layers[item.index].icon} size={16} /></span>
                      <span className="palette-main">{t('palette.switchLayer')} · <b>{t(`layer.${item.id}`)}</b></span>
                      <kbd>{item.index === 9 ? 'D' : item.index + 1}</kbd>
                    </div>
                  );
                }
                const cell = world!.cells[item.id];
                return (
                  <div key={`c-${item.id}`} {...common}>
                    <i className="swatch" style={{ background: terrainColor(cell.terrain) }} />
                    <span className="palette-main"><b>{t('inspector.cell', { value: number(cell.id + 1) })}</b> · {t(`terrain.${cell.terrain}`)}</span>
                    <span className="palette-meta">{t(locationKey(cell))} · {t('unit.m', { value: number(cell.elevation_m) })}</span>
                  </div>
                );
              })}
            </div>
            <div className="palette-foot">{t('palette.hint')}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: Array<[string[], string]> = [
    [['1', '…', '9', 'D'], t('shortcuts.layers')],
    [['R'], t('shortcuts.rivers')],
    [['B'], t('shortcuts.borders')],
    [['G'], t('shortcuts.graticule')],
    [['Space'], t('shortcuts.play')],
    [['←', '→'], t('shortcuts.months')],
    [['⌘', 'K'], t('shortcuts.search')],
    [['+', '−'], t('shortcuts.zoom')],
    [['0'], t('shortcuts.fit')],
    [['[', ']'], t('shortcuts.panels')],
    [['?'], t('shortcuts.help')],
  ];
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div className="help glass" role="dialog" aria-modal="true" aria-label={t('shortcuts.title')}
            initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} onMouseDown={(event) => event.stopPropagation()}>
            <header><h3><Icon name="keyboard" size={18} />{t('shortcuts.title')}</h3><button type="button" className="icon-ghost" onClick={onClose} aria-label={t('shortcuts.close')}><Icon name="close" size={16} /></button></header>
            <dl>{rows.map(([keys, label]) => <div key={label}><dt>{keys.map((k, i) => k === '…' ? <span key={i}>–</span> : <kbd key={i}>{k}</kbd>)}</dt><dd>{label}</dd></div>)}</dl>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
