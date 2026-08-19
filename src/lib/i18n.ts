/**
 * Lightweight i18n for EdificARTE.
 *
 * - Locales: 'es' (default) | 'en'
 * - Persistence: localStorage['edificarte_locale'] (browser only).
 * - Server-side: pass `defaultLocale` to <Layout locale={...} /> from the page,
 *   or accept the browser default via SSR cookie.
 * - Translation lookup uses dot-notation: t('mapa.welcome.title').
 *
 * NOT a full i18n framework: no plural rules, no ICU, no SSR cookie sync yet.
 * The data layer (monuments, tours) carries its own `translations` field and
 * is consumed separately via `pickLocalized(monument, locale)`.
 */

export type Locale = 'es' | 'en';

export const SUPPORTED_LOCALES: Locale[] = ['es', 'en'];
export const DEFAULT_LOCALE: Locale = 'es';

export const LOCALE_STORAGE_KEY = 'edificarte_locale';

/** Read locale from URL (?lang=en) or localStorage or browser hint. Browser-only. */
export function detectLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;

  // 1) Explicit URL param wins (used by SSR redirect / shareable link).
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get('lang');
    if (q && (SUPPORTED_LOCALES as string[]).includes(q)) return q as Locale;
  } catch {
    /* ignore */
  }

  // 2) Persisted choice from previous session.
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && (SUPPORTED_LOCALES as string[]).includes(stored)) {
      return stored as Locale;
    }
  } catch {
    /* ignore */
  }

  // 3) Browser language hint.
  const navLang = (typeof navigator !== 'undefined' && navigator.language) || '';
  if (navLang.toLowerCase().startsWith('en')) return 'en';

  return DEFAULT_LOCALE;
}

/** Persist a locale choice and emit a change event so the DOM can update. */
export function setLocale(loc: Locale): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, loc);
    document.documentElement.setAttribute('lang', loc);
    document.cookie = `edificarte_locale=${loc}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent('locale:change', { detail: { locale: loc } }));
}

/**
 * Resolve a dotted key against a flat dictionary.
 * Returns the key itself when missing (so the UI never blanks out).
 *
 * Supports {var} interpolation: t('foo.bar', { name: 'Ana' }) on
 * "Hello {name}" → "Hello Ana".
 */
export function translate(
  dict: Record<string, unknown>,
  key: string,
  vars?: Record<string, string | number>
): string {
  const parts = key.split('.');
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return key; // graceful: show the key when missing
    }
  }
  if (typeof cur !== 'string') return key;
  if (!vars) return cur;
  return cur.replace(/\{(\w+)\}/g, (_, name) =>
    name in vars ? String(vars[name]) : `{${name}}`
  );
}

/**
 * Pick the localized field of a data entity, falling back to default locale.
 * Used by monuments/tours: each item may carry `translations: { es, en }`.
 */
export function pickLocalized<T extends object>(
  entity: T,
  field: string,
  locale: Locale
): string {
  const tr = (entity as { translations?: Record<Locale, Record<string, string>> }).translations;
  if (tr && tr[locale] && field in tr[locale]) {
    return tr[locale][field];
  }
  const fallback = tr?.[DEFAULT_LOCALE];
  if (fallback && field in fallback) {
    return fallback[field];
  }
  const direct = (entity as Record<string, unknown>)[field];
  return typeof direct === 'string' ? direct : '';
}
