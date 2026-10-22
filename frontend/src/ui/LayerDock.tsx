import { AnimatePresence, motion } from 'motion/react';
import { t } from '../i18n';
import type { Layer, ResourceKind } from '../types';
import { Icon } from './Icon';
import { isClimateLayer, layers, resources } from './shared';

interface Props {
  layer: Layer;
  resource: ResourceKind;
  month?: number;
  playing: boolean;
  onLayer: (layer: Layer) => void;
  onResource: (resource: ResourceKind) => void;
  onMonth: (month?: number) => void;
  onPlay: () => void;
}

const spring = { type: 'spring', stiffness: 520, damping: 38 } as const;

export function LayerDock({ layer, resource, month, playing, onLayer, onResource, onMonth, onPlay }: Props) {
  return (
    <div className="dock-wrap">
      <AnimatePresence mode="wait" initial={false}>
        {isClimateLayer(layer) && (
          <motion.div key="months" className="sub-dock glass" initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.97 }} transition={{ duration: 0.22 }}>
            <button type="button" className={`play-button${playing ? ' playing' : ''}`} onClick={onPlay}
              aria-label={t(playing ? 'climate.pause' : 'climate.play')} data-tip={`${t(playing ? 'climate.pause' : 'climate.play')} · Space`}>
              <Icon name={playing ? 'pause' : 'play'} size={14} />
            </button>
            <div className="month-track" role="radiogroup" aria-label={t('climate.period')}>
              {[undefined, ...Array.from({ length: 12 }, (_, i) => i)].map((value) => {
                const active = value === month;
                return (
                  <button key={value ?? 'annual'} type="button" role="radio" aria-checked={active}
                    className={`month-chip${active ? ' active' : ''}${value === undefined ? ' annual' : ''}`} onClick={() => onMonth(value)}>
                    {active && <motion.span layoutId="month-pill" className="pill" transition={spring} />}
                    <span className="label">{value === undefined ? t('climate.annual') : value + 1}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
        {layer === 'resources' && (
          <motion.div key="resources" className="sub-dock glass" initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.97 }} transition={{ duration: 0.22 }}>
            <div className="month-track" role="radiogroup" aria-label={t('layers.resource')}>
              {resources.map((kind) => {
                const active = kind === resource;
                return (
                  <button key={kind} type="button" role="radio" aria-checked={active} className={`month-chip resource${active ? ' active' : ''}`} onClick={() => onResource(kind)}>
                    {active && <motion.span layoutId="resource-pill" className="pill gold" transition={spring} />}
                    <span className="label">{t(`resource.${kind}`)}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <nav className="layer-dock glass" aria-label={t('layers.title')}>
        {layers.map(({ id, icon }, index) => {
          const active = id === layer;
          return (
            <button key={id} type="button" className={`layer-button${active ? ' active' : ''}`} aria-label={t(`layer.${id}`)} title={t(`layer.${id}`)} aria-pressed={active} onClick={() => onLayer(id)}>
              {active && <motion.span layoutId="layer-pill" className="pill" transition={spring} />}
              <Icon name={icon} size={19} />
              <span className="label">{t(`layer.${id}`)}</span>
              <kbd>{index + 1}</kbd>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
