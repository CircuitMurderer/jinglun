import { zhCN } from './zh-CN';

export type MessageKey = keyof typeof zhCN;
export type Locale = 'zh-CN';
export type Params = Record<string, string | number>;
type Dictionary = Record<MessageKey, string>;
// Adding a locale later requires a complete dictionary with the same keys.
const dictionaries: Record<Locale, Dictionary> = { 'zh-CN': zhCN };
let locale: Locale = 'zh-CN';

export function setLocale(next: Locale): void {
  locale = next;
  document.documentElement.lang = next;
}
export function getLocale(): Locale { return locale; }
export function isMessageKey(key: string): key is MessageKey { return Object.hasOwn(zhCN, key); }
export function t(key: MessageKey, params: Params = {}): string {
  return dictionaries[locale][key].replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));
}
export function number(value: number, decimals = 0): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: decimals }).format(value);
}
export function percent(value: number, decimals = 0): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: decimals }).format(value);
}
