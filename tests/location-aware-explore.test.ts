import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeResolvedLocation, validateCoordinates } from '../src/lib/location/country';
import { getPublicExploreInfo, publicExploreLimits } from '../src/lib/public-data/explore';
import { POST as locationPost } from '../src/pages/api/explore/location';
import { GET as toursGet, POST as toursPost, PATCH as toursPatch } from '../src/pages/api/admin/tours';
import { GET as productsGet, POST as productsPost, PATCH as productsPatch } from '../src/pages/api/admin/products';

const getD1ManagedItems = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/location/catalog', () => ({ getD1ManagedItems, getSupabaseManagedItems: () => Promise.resolve(null) }));

function localsWithDb(db: unknown) {
  return { adminAuthorized: true, runtime: { env: { DB: db } } };
}

function d1Response(items: unknown[] | null) {
  getD1ManagedItems.mockResolvedValue(items);
}

function reverseGeocodeResponse(countryCode = 'ca') {
  return new Response(JSON.stringify({ address: { country_code: countryCode, country: 'Canada' } }));
}

function request() {
  return new Request('https://app.test/api/explore/location', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ latitude: 45, longitude: -75 }),
  });
}

function dbWithRows(rows: unknown[] = []) {
  return {
    prepare: vi.fn((_sql: string) => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => ({ results: rows })),
        first: vi.fn(async () => ({ count: rows.length })),
        run: vi.fn(async () => ({})),
      })),
    })),
  };
}

describe('location-aware Explore contracts', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    getD1ManagedItems.mockReset();
  });

  it('accepts only finite coordinates and normalizes resolved country', () => {
    expect(validateCoordinates({ latitude: 19.4, longitude: -99.1 })).toEqual({ latitude: 19.4, longitude: -99.1 });
    expect(validateCoordinates({ latitude: 91, longitude: 0 })).toBeNull();
    expect(normalizeResolvedLocation('mx', 'Mexico City')).toEqual({ status: 'resolved', countryCode: 'MX', city: 'Mexico City' });
    expect(normalizeResolvedLocation('Mexico')).toEqual({ status: 'unresolved' });
  });

  it('bounds and attributes public fallback results with photos', async () => {
    const response = new Response(JSON.stringify({ query: { pages: {
      1: { title: 'Museum of Fine Arts', pageid: 1, extract: 'Art museum', thumbnail: { source: 'https://upload.wikimedia.org/museum.jpg' } },
      2: { title: 'Historic Center', pageid: 2, extract: 'Heritage site' },
    } } }), { headers: { 'content-type': 'application/json' } });
    const items = await getPublicExploreInfo({ countryCode: 'CA', latitude: 45.5, longitude: -73.5 }, async () => response);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'Museum of Fine Arts',
      sourceName: 'Wikipedia',
      sourceUrl: 'https://es.wikipedia.org/?curid=1',
      imageUrl: 'https://upload.wikimedia.org/museum.jpg',
    });
    expect(publicExploreLimits.maxResults).toBe(12);
  });

  it('fails closed when the public adapter times out or errors', async () => {
    const items = await getPublicExploreInfo('CA', async () => { throw new Error('network'); });
    expect(items).toEqual([]);
  });

  it('uses D1 managed items and reports the selected source', async () => {
    d1Response([{ id: 's1', title: 'Canada', description: 'Managed', countryCode: 'CA', kind: 'place' }]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reverseGeocodeResponse());
    const response = await locationPost({ request: request(), locals: localsWithDb(dbWithRows()) } as never);
    const body = await response.json();
    expect(body.managedSource).toBe('d1');
    expect(body.managed).toHaveLength(1);
  });

  it('handles empty D1 records gracefully', async () => {
    d1Response([]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reverseGeocodeResponse());
    const response = await locationPost({ request: request(), locals: localsWithDb(dbWithRows()) } as never);
    const body = await response.json();
    expect(body.managedSource).toBe('none');
    expect(body.managed).toHaveLength(0);
  });

  it('does not query managed content for invalid coordinates', async () => {
    const response = await locationPost({
      request: new Request('https://app.test/api/explore/location', { method: 'POST', body: JSON.stringify({ latitude: 999, longitude: 0 }) }),
      locals: localsWithDb(dbWithRows()),
    } as never);
    expect(response.status).toBe(400);
    expect(getD1ManagedItems).not.toHaveBeenCalled();
  });

  it('keeps unresolved location neutral without querying managed content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));
    const response = await locationPost({ request: request(), locals: localsWithDb(dbWithRows()) } as never);
    const body = await response.json();
    expect(body.location).toEqual({ status: 'unresolved' });
    expect(body.managed).toEqual([]);
    expect(getD1ManagedItems).not.toHaveBeenCalled();
  });

  it('round-trips admin tour and product country codes through SQL handlers', async () => {
    const tourDb = dbWithRows([{ id: 't1', title: 'Tour', country_code: 'CA', country: 'Canada', highlights: '[]', guide: '{}', translations: '{}' }]);
    const productDb = dbWithRows([{ id: 'p1', name: 'Product', country_code: 'CA', origin: 'Canada', images: '[]' }]);
    const admin = (db: unknown) => ({ adminAuthorized: true, runtime: { env: { DB: db } } });
    expect((await toursPost({ request: new Request('https://app.test', { method: 'POST', body: JSON.stringify({ title: 'Tour', countryCode: 'ca' }) }), locals: admin(tourDb) } as never)).status).toBe(200);
    expect((await toursPatch({ request: new Request('https://app.test', { method: 'PATCH', body: JSON.stringify({ id: 't1', countryCode: 'us' }) }), locals: admin(tourDb) } as never)).status).toBe(200);
    expect((await productsPost({ request: new Request('https://app.test', { method: 'POST', body: JSON.stringify({ name: 'Product', countryCode: 'ca' }) }), locals: admin(productDb) } as never)).status).toBe(200);
    expect((await productsPatch({ request: new Request('https://app.test', { method: 'PATCH', body: JSON.stringify({ id: 'p1', countryCode: 'us' }) }), locals: admin(productDb) } as never)).status).toBe(200);
    const tourBody = await (await toursGet({ url: new URL('https://app.test'), locals: admin(tourDb) } as never)).json();
    const productBody = await (await productsGet({ url: new URL('https://app.test'), locals: admin(productDb) } as never)).json();
    expect(tourBody.tours[0].countryCode).toBe('CA');
    expect(productBody.products[0].countryCode).toBe('CA');
    expect(tourDb.prepare.mock.calls.some(([sql]) => sql.includes('country_code'))).toBe(true);
    expect(productDb.prepare.mock.calls.some(([sql]) => sql.includes('country_code'))).toBe(true);
  });

  it('covers the deterministic Explore DOM smoke contract when no browser harness exists', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/pages/explorar.astro', import.meta.url), 'utf8'));
    expect(source).toContain('id="explore-location-status"');
    expect(source).toContain('id="explore-public-info"');
    expect(source).toContain('Location permission was denied or unavailable');
    expect(source).toContain("activeCountry = '__unknown__'");
    // Real geolocation permission prompts remain manual: Vitest runs in Node, not a browser.
  });

  it('keeps legacy Mexico display text while filtering tours by normalized country code', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/pages/explorar.astro', import.meta.url), 'utf8'));
    expect(source).toContain('countryCode: __normalizeCountryCode(r.country_code, r.country)');
    expect(source).toContain('country: r.country');
    expect(source).toContain("data-country={exp.isTour ? (TOURS.find((tour) => tour.id === exp.id)?.countryCode || '') : 'MX'}");

    const cards = [{ title: 'MX tour', country: 'MX' }, { title: 'CA tour', country: 'CA' }];
    const resolvedCountry = 'MX';
    expect(cards.filter((card) => card.country === resolvedCountry).map((card) => card.title)).toEqual(['MX tour']);
  });

  it('extracts city information and supports Spanish city unavailability messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ address: { country_code: 'mx', city: 'Zapopan' } }))
    );
    const response = await locationPost({ request: request(), locals: localsWithDb(dbWithRows()) } as never);
    const body = await response.json();
    expect(body.location).toEqual({ status: 'resolved', countryCode: 'MX', city: 'Zapopan' });

    const exploreSource = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/pages/explorar.astro', import.meta.url), 'utf8'));
    // Page is i18n'd via tr(); assert the unavailability key is wired and its Spanish template interpolates the city.
    expect(exploreSource).toContain("tr('explorar.location.unavailable_place', { place: city })");
    const esDict = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/i18n/es.json', import.meta.url), 'utf8')));
    expect(esDict.explorar.location.unavailable_place).toBe('No hay servicios cercanos disponibles en {place}');

    const storeSource = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/pages/tienda.astro', import.meta.url), 'utf8'));
    expect(storeSource).toContain('id="store-location-status"');
    expect(storeSource).toContain('renderComingSoonHolders');
    expect(storeSource).toContain('Coming Soon');
  });
});
