import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { Icon } from './Icon';
import { ThemePicker } from './ThemePicker';

export function GameMenu({ debug, version, onDebug }: { debug: boolean; version: string; onDebug: (enabled: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !host.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return <div className="game-menu" ref={host} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className="game-menu-trigger" aria-expanded={open}
      aria-controls="game-menu-panel" onClick={() => setOpen(value => !value)}>
      <Icon name="menu" size={17} /><span>{t('menu.title')}</span>
      {debug && <span className="debug-indicator">DEBUG</span>}
    </button>
    {open && <div id="game-menu-panel" className="game-menu-panel glass" role="region" aria-label={t('menu.title')}>
      <div className="menu-heading">{t('menu.title')}</div>
      <ThemePicker />
      <button type="button" className="debug-switch" role="switch" aria-checked={debug}
        onClick={() => { onDebug(!debug); setOpen(false); trigger.current?.focus(); }}>
        <span>{t('menu.debug')}</span><span className="switch-track" aria-hidden="true"><i /></span>
      </button>
      <p className="menu-note">{t('menu.debugHint')}</p>
      <div className="menu-version mono">{version}</div>
    </div>}
  </div>;
}
