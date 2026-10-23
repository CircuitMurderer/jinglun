import { useSyncExternalStore } from 'react';
import { t } from '../i18n';
import { getThemeSnapshot, setThemePreference, subscribeTheme, type ThemePreference } from '../theme';
import { Icon } from './Icon';

export function useTheme() {
  return useSyncExternalStore(subscribeTheme, getThemeSnapshot);
}

export function ThemePicker() {
  const { preference, resolved } = useTheme();
  return (
    <label className="theme-picker" data-tip={t('theme.label')}>
      <Icon name={preference === 'system' ? 'monitor' : resolved === 'light' ? 'sun' : 'moon'} size={16} />
      <select aria-label={t('theme.label')} value={preference}
        onChange={(event) => setThemePreference(event.target.value as ThemePreference)}>
        <option value="system">{t('theme.system')}</option>
        <option value="light">{t('theme.light')}</option>
        <option value="dark">{t('theme.dark')}</option>
      </select>
    </label>
  );
}
