import { catalog } from '../locales/catalog.ts';
import ttLatn from '../locales/tt-Latn.ts';
import sah from '../locales/sah.ts';
import kk from '../locales/kk.ts';
import ja from '../locales/ja.ts';
import tr from '../locales/tr.ts';
import az from '../locales/az.ts';
import uz from '../locales/uz.ts';
import ky from '../locales/ky.ts';
import ba from '../locales/ba.ts';
import zhHans from '../locales/zh-Hans.ts';
import ar from '../locales/ar.ts';
import pt from '../locales/pt.ts';
import it from '../locales/it.ts';
import ko from '../locales/ko.ts';
import pl from '../locales/pl.ts';
import uk from '../locales/uk.ts';
import be from '../locales/be.ts';

export const languageGroups = ['Popular languages', 'Turkic languages', 'Languages of Russia'] as const;
// Editorial order by approximate worldwide reach, not LinkGuard usage analytics.
export const languages = [
  { code: 'en', name: 'English', group: 'Popular languages' },
  { code: 'zh-Hans', name: '简体中文', group: 'Popular languages' },
  { code: 'es', name: 'Español', group: 'Popular languages' },
  { code: 'ar', name: 'العربية', group: 'Popular languages' },
  { code: 'fr', name: 'Français', group: 'Popular languages' },
  { code: 'pt', name: 'Português', group: 'Popular languages' },
  { code: 'ru', name: 'Русский', group: 'Popular languages' },
  { code: 'de', name: 'Deutsch', group: 'Popular languages' },
  { code: 'ja', name: '日本語', group: 'Popular languages' },
  { code: 'ko', name: '한국어', group: 'Popular languages' },
  { code: 'it', name: 'Italiano', group: 'Popular languages' },
  { code: 'pl', name: 'Polski', group: 'Popular languages' },
  { code: 'uk', name: 'Українська', group: 'Popular languages' },
  { code: 'be', name: 'Беларуская', group: 'Popular languages' },
  { code: 'tr', name: 'Türkçe', group: 'Turkic languages' },
  { code: 'uz', name: 'O‘zbekcha', group: 'Turkic languages' },
  { code: 'az', name: 'Azərbaycanca', group: 'Turkic languages' },
  { code: 'kk', name: 'Қазақша', group: 'Turkic languages' },
  { code: 'ky', name: 'Кыргызча', group: 'Turkic languages' },
  { code: 'tt', name: 'Татарча (кириллица)', group: 'Languages of Russia' },
  { code: 'tt-Latn', name: 'Tatarça (latin)', group: 'Languages of Russia' },
  { code: 'ba', name: 'Башҡортса', group: 'Languages of Russia' },
  { code: 'sah', name: 'Саха тыла', group: 'Languages of Russia' },
] as const;
export type Locale = typeof languages[number]['code'];
const originalCodes = ['ru', 'es', 'fr', 'de', 'tt'] as const;
const extraCatalogs: Partial<Record<Locale, Record<string, string>>> = { 'tt-Latn': ttLatn, sah, kk, ja, tr, az, uz, ky, ba, 'zh-Hans': zhHans, ar, pt, it, ko, pl, uk, be };
export function getMessages(locale: Locale): Record<string, string> {
  if (locale === 'en') return Object.fromEntries(Object.keys(catalog).map(key => [key, key]));
  if (extraCatalogs[locale]) return extraCatalogs[locale]!;
  const index = originalCodes.findIndex(code => code === locale);
  return Object.fromEntries(Object.entries(catalog).map(([key, values]) => [key, values[index] ?? key]));
}
const messages = Object.fromEntries(languages.map(({ code }) => [code, getMessages(code)])) as Record<Locale, Record<string, string>>;
export function isLocale(value: unknown): value is Locale {
  return languages.some(language => language.code === value);
}
function matchLocale(value: string): Locale | undefined {
  return languages.find(language => language.code.toLowerCase() === value.toLowerCase())?.code;
}
export function detectLocale(preferences: readonly string[]): Locale {
  for (const preference of preferences) {
    const tag = preference.replaceAll('_', '-');
    const parts = tag.split('-');
    const exact = matchLocale(tag);
    if (exact) return exact;
    // Preserve script distinctions when removing a region: tt-Latn-RU → tt-Latn.
    const script = parts.slice(1).find(part => /^[a-z]{4}$/i.test(part));
    const scripted = script && matchLocale(`${parts[0]}-${script}`);
    if (scripted) return scripted;
    if (parts[0]?.toLowerCase() === 'zh') {
      // Do not present Simplified Chinese as a Traditional Chinese translation.
      if (parts.some(part => /^(Hant|TW|HK|MO)$/i.test(part))) continue;
      return 'zh-Hans';
    }
    const base = matchLocale(parts[0] ?? '');
    if (base) return base;
  }
  return 'en';
}
export function resolveLocale(saved: unknown, preferences: readonly string[]): Locale {
  return isLocale(saved) ? saved : detectLocale(preferences);
}
export function translate(locale: Locale, text: string, params: Record<string, string | number> = {}): string {
  const template = Object.hasOwn(messages[locale], text) ? messages[locale][text]! : text;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => String(params[name] ?? placeholder));
}

export function getDirection(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}
