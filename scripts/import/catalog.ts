import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

type EntityType = 'precinct' | 'place' | 'tour';
type SourceRow = Record<string, unknown> & {
  type?: unknown;
  legacyKey?: unknown;
};
type StableMap = {
  entityType: EntityType;
  legacyKey: string;
  catalogId: string;
};
export type CatalogReject = {
  ordinal: number;
  entityType: string;
  legacyKey: string | null;
  code: string;
  detail: Record<string, unknown>;
  rowSha256: string;
};

const sha256 = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');

function stableUuid(value: string): string {
  const hex = sha256(value).slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(',')}}`;
}

function rejectCode(row: SourceRow, knownPlaces: Set<string>): string | null {
  if (!['precinct', 'place', 'tour'].includes(String(row.type)))
    return 'INVALID_ENTITY_TYPE';
  if (
    typeof row.legacyKey !== 'string' ||
    !row.legacyKey.trim() ||
    row.legacyKey.trim().length > 255
  )
    return 'MISSING_LEGACY_KEY';
  if (row.type === 'place') {
    if (!Array.isArray(row.coordinates) || row.coordinates.length !== 2)
      return 'INVALID_COORDINATES';
    const [longitude, latitude] = row.coordinates;
    if (
      typeof longitude !== 'number' ||
      typeof latitude !== 'number' ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90
    )
      return 'INVALID_COORDINATES';
  }
  if (row.type === 'tour') {
    if (
      !Array.isArray(row.placeKeys) ||
      row.placeKeys.some((key) => typeof key !== 'string')
    )
      return 'INVALID_REFERENCE';
    if (row.placeKeys.some((key) => !knownPlaces.has(key as string)))
      return 'MISSING_REFERENCE';
    if (new Set(row.placeKeys).size !== row.placeKeys.length)
      return 'AMBIGUOUS_REFERENCE';
  }
  return null;
}

export async function readCatalogSource(path: string): Promise<Uint8Array> {
  if (!path) throw new Error('An explicit local catalog path is required');
  return readFile(path);
}

export function prepareCatalogImport(
  sourceName: string,
  bytes: Uint8Array,
  existingMaps: StableMap[] = [],
  batchSize = 100
) {
  if (!/^[a-z][a-z0-9_-]*$/.test(sourceName))
    throw new Error('Invalid catalog source name');
  if (!Number.isInteger(batchSize) || batchSize < 1)
    throw new Error('Batch size must be a positive integer');
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
  if (!Array.isArray(parsed))
    throw new Error('Catalog source must be a JSON array');
  const rows = parsed as SourceRow[];
  const knownPlaces = new Set(
    rows
      .filter(
        (row) => row.type === 'place' && typeof row.legacyKey === 'string'
      )
      .map((row) => row.legacyKey as string)
  );
  const existing = new Map(
    existingMaps.map((map) => [
      `${map.entityType}:${map.legacyKey}`,
      map.catalogId,
    ])
  );
  const accepted: Array<Record<string, unknown>> = [];
  const rejects: CatalogReject[] = [];
  const maps: StableMap[] = [];

  rows.forEach((row, ordinal) => {
    const canonical = canonicalize(row);
    const rowSha256 = sha256(canonical);
    const code = rejectCode(row, knownPlaces);
    if (code) {
      rejects.push({
        ordinal,
        entityType: String(row.type ?? 'unknown'),
        legacyKey: typeof row.legacyKey === 'string' ? row.legacyKey : null,
        code,
        detail: {},
        rowSha256,
      });
      return;
    }
    const entityType = row.type as EntityType;
    const legacyKey = row.legacyKey as string;
    accepted.push({
      ordinal,
      entityType,
      legacyKey,
      canonicalRow: JSON.parse(canonical),
      rowSha256,
    });
    maps.push({
      entityType,
      legacyKey,
      catalogId:
        existing.get(`${entityType}:${legacyKey}`) ??
        stableUuid(`${sourceName}:${entityType}:${legacyKey}`),
    });
  });

  accepted.sort((a, b) =>
    `${a.entityType}:${a.legacyKey}`.localeCompare(
      `${b.entityType}:${b.legacyKey}`
    )
  );
  rejects.sort((a, b) => a.ordinal - b.ordinal);
  maps.sort((a, b) =>
    `${a.entityType}:${a.legacyKey}`.localeCompare(
      `${b.entityType}:${b.legacyKey}`
    )
  );
  const canonicalSha256 = sha256(canonicalize(rows));
  const batches = <T>(values: T[]) =>
    Array.from({ length: Math.ceil(values.length / batchSize) }, (_, index) =>
      values.slice(index * batchSize, (index + 1) * batchSize)
    );
  return {
    manifest: {
      sourceName,
      sourceSha256: sha256(bytes),
      canonicalSha256,
      expectedRows: rows.length,
    },
    stagedBatches: batches(accepted),
    rejectBatches: batches(rejects),
    mapBatches: batches(maps),
  };
}
