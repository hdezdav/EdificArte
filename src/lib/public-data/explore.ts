export type PublicInfoItem = {
  title: string;
  description: string;
  sourceName: 'Wikipedia';
  sourceUrl: string;
  imageUrl?: string;
  categoryHint?: string;
};

export type LocationInput = string | {
  countryCode?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
};

const WIKIPEDIA_ES = 'https://es.wikipedia.org/w/api.php';
const WIKIPEDIA_EN = 'https://en.wikipedia.org/w/api.php';
const MAX_RESULTS = 12;
const GEO_RADIUS = 10000;
const MAX_BYTES = 250_000;
const TIMEOUT_MS = 4000;

const COUNTRY_NAMES: Record<string, [string, string]> = {
  MX: ['México', 'Mexico'], CO: ['Colombia', 'Colombia'], AR: ['Argentina', 'Argentina'],
  CL: ['Chile', 'Chile'], PE: ['Perú', 'Peru'], VE: ['Venezuela', 'Venezuela'],
  EC: ['Ecuador', 'Ecuador'], BO: ['Bolivia', 'Bolivia'], UY: ['Uruguay', 'Uruguay'],
  PY: ['Paraguay', 'Paraguay'], CR: ['Costa Rica', 'Costa Rica'], PA: ['Panamá', 'Panama'],
  GT: ['Guatemala', 'Guatemala'], HN: ['Honduras', 'Honduras'], SV: ['El Salvador', 'El Salvador'],
  NI: ['Nicaragua', 'Nicaragua'], DO: ['República Dominicana', 'Dominican Republic'],
  CU: ['Cuba', 'Cuba'], ES: ['España', 'Spain'], US: ['Estados Unidos', 'United States'],
  BR: ['Brasil', 'Brazil'], FR: ['Francia', 'France'], DE: ['Alemania', 'Germany'],
  IT: ['Italia', 'Italy'], GB: ['Reino Unido', 'United Kingdom'], JP: ['Japón', 'Japan'],
  CN: ['China', 'China'], IN: ['India', 'India'], PT: ['Portugal', 'Portugal'],
};

// Titles to skip: drainage features, administrative divisions (barrios, comunas, etc.)
// Using ^ anchors so "Museo del Barrio" is NOT skipped — only titles that START with these words.
const SKIP_TITLE_PATTERN = /^(quebrada|arroyo|riachuelo|caño |acequia|zanja|vertiente|barrio |comuna |vereda |corregimiento |municipio de |departamento de |provincia de |distrito de )/i;

function buildGeoUrl(base: string, lat: number, lng: number): string {
  return `${base}?action=query&generator=geosearch&ggscoord=${lat}|${lng}&ggsradius=${GEO_RADIUS}&ggslimit=10&prop=pageimages|extracts&piprop=thumbnail&pithumbsize=600&exintro=1&explaintext=1&exchars=280&format=json&origin=*`;
}

function buildSearchUrl(base: string, term: string, limit = 4): string {
  return `${base}?action=query&generator=search&gsrsearch=${encodeURIComponent(term)}&gsrlimit=${limit}&prop=pageimages|extracts&piprop=thumbnail&pithumbsize=600&exintro=1&explaintext=1&exchars=280&format=json&origin=*`;
}

async function fetchWikiPages(
  url: string,
  domain: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
  categoryHint?: string,
): Promise<PublicInfoItem[]> {
  try {
    const response = await fetcher(url, {
      signal,
      headers: {
        'accept': 'application/json',
        'user-agent': 'EdificARTE/1.0 (https://edificarte.app; contact@edificarte.app)',
      },
    });
    if (!response.ok) return [];
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_BYTES) return [];
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BYTES) return [];
    const payload = JSON.parse(text) as {
      query?: {
        pages?: Record<string, { pageid?: number; title?: string; extract?: string; snippet?: string; thumbnail?: { source?: string } }>;
      };
    };
    const pages = Object.values(payload.query?.pages ?? {});
    return pages.flatMap((item) => {
      if (!item.title || !item.pageid) return [];
      if (SKIP_TITLE_PATTERN.test(item.title)) return [];
      const rawDesc = item.extract || (item.snippet || '').replace(/<[^>]*>/g, '');
      return [{
        title: item.title.slice(0, 160),
        description: rawDesc.slice(0, 400).trim(),
        sourceName: 'Wikipedia' as const,
        sourceUrl: `https://${domain}/?curid=${item.pageid}`,
        ...(item.thumbnail?.source ? { imageUrl: item.thumbnail.source } : {}),
        ...(categoryHint ? { categoryHint } : {}),
      }];
    });
  } catch {
    return [];
  }
}

function dedup(items: PublicInfoItem[]): PublicInfoItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getPublicExploreInfo(input: LocationInput, fetcher: typeof fetch = fetch): Promise<PublicInfoItem[]> {
  const params = typeof input === 'string' ? { countryCode: input } : input || {};
  const countryCode = (params.countryCode || '').toUpperCase();
  const city = params.city || '';
  const latitude = typeof params.latitude === 'number' && Number.isFinite(params.latitude) ? params.latitude : null;
  const longitude = typeof params.longitude === 'number' && Number.isFinite(params.longitude) ? params.longitude : null;

  const countryNames = COUNTRY_NAMES[countryCode];
  const countryEs = countryNames?.[0] ?? 'México';
  const loc = [city, countryEs].filter(Boolean).join(' ');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const allResults: PublicInfoItem[] = [];

    if (latitude !== null && longitude !== null) {
      // Primary: geosearch on ES Wikipedia
      const geoEs = await fetchWikiPages(buildGeoUrl(WIKIPEDIA_ES, latitude, longitude), 'es.wikipedia.org', fetcher, controller.signal);
      allResults.push(...geoEs);

      // If geosearch thin, also try EN
      if (geoEs.length < 4) {
        const geoEn = await fetchWikiPages(buildGeoUrl(WIKIPEDIA_EN, latitude, longitude), 'en.wikipedia.org', fetcher, controller.signal);
        allResults.push(...geoEn);
      }
    }

    // Text search: targeted queries when geosearch yields thin or empty results
    if (allResults.length < 4) {
      const searchTarget = loc || 'Ciudad de México';
      const textQueries = await Promise.allSettled([
        fetchWikiPages(buildSearchUrl(WIKIPEDIA_ES, `monumentos de ${searchTarget}`, 6), 'es.wikipedia.org', fetcher, controller.signal, 'patrimonio'),
        fetchWikiPages(buildSearchUrl(WIKIPEDIA_ES, `museos de ${searchTarget}`, 6), 'es.wikipedia.org', fetcher, controller.signal, 'museo'),
      ]);
      textQueries.forEach(r => r.status === 'fulfilled' && allResults.push(...r.value));
    }

    return dedup(allResults).slice(0, MAX_RESULTS);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export const publicExploreLimits = { maxResults: MAX_RESULTS, maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS } as const;
