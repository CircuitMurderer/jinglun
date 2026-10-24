import { useEffect, useRef } from 'react';
import { number, t } from '../i18n';
import type { WorldEntry } from '../world-entry';
import { Icon } from './Icon';

export function WorldEntryPanel({ entry, onConfigure, onConfirm }: {
  entry: Exclude<WorldEntry, { stage: 'setup' }>;
  onConfigure: () => void;
  onConfirm: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [entry.stage]);

  return <section className="entry-panel" aria-labelledby="entry-heading">
    <p className="eyebrow">{t(entry.stage === 'round' ? 'round.eyebrow' : 'entry.eyebrow')}</p>
    <h2 id="entry-heading" ref={heading} tabIndex={-1}>
      {entry.stage === 'confirm' ? t('entry.confirmQuestion')
        : t('round.date', { year: number(entry.round.year), month: number(entry.round.month) })}
    </h2>
    {entry.stage === 'confirm' ? <div className="entry-actions">
      <button type="button" className="ghost-button" onClick={onConfigure}>{t('entry.regenerate')}</button>
      <button type="button" className="generate-button" onClick={onConfirm}>
        <span>{t('entry.confirm')}</span><Icon name="arrow" size={17} />
      </button>
    </div> : <p className="section-sub">{t('round.beginning')}</p>}
  </section>;
}
