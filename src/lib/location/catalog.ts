import { normalizeCountryCode } from './country';

export type ManagedCatalogItem = { id: string; title: string; description: string; countryCode: string; kind: 'place' | 'tour' };

export const managedCatalogTimeoutMs = 1500;

export async function getD1ManagedItems(db: Env['DB'], countryCode: string): Promise<ManagedCatalogItem[] | null> {
  const normalized = normalizeCountryCode(countryCode);
  if (!normalized || !db) return null;
  try {
    const [tours, products] = await Promise.all([
      db.prepare('SELECT id, title, description FROM tours WHERE is_published = 1 AND country_code = ? LIMIT 50').bind(normalized).all(),
      db.prepare('SELECT id, name as title, description FROM products WHERE is_published = 1 AND country_code = ? LIMIT 50').bind(normalized).all(),
    ]);
    return [
      ...((tours.results || []) as Array<{ id: string; title: string; description: string }>).map((row) => ({ id: row.id, title: row.title, description: row.description || 'Tour guiado', countryCode: normalized, kind: 'tour' as const })),
      ...((products.results || []) as Array<{ id: string; title: string; description: string }>).map((row) => ({ id: row.id, title: row.title, description: row.description || 'Producto artesanal', countryCode: normalized, kind: 'place' as const })),
    ];
  } catch {
    return null;
  }
}

// Compatibility fallback
export async function getSupabaseManagedItems(_env: unknown, _countryCode: string): Promise<ManagedCatalogItem[] | null> {
  return null;
}
