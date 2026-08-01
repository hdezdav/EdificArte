import { describe, expect, it } from 'vitest';
import { prepareCatalogImport } from '../scripts/import/catalog';

const source = Buffer.from(
  JSON.stringify([
    { type: 'tour', legacyKey: 'walk', placeKeys: ['museum'] },
    { legacyKey: 'museum', coordinates: [-99.13, 19.43], type: 'place' },
    { type: 'place', legacyKey: 'reversed', coordinates: [19.43, -120] },
    { type: 'tour', legacyKey: 'unknown-stop', placeKeys: ['missing'] },
    { type: 'tour', legacyKey: 'ambiguous', placeKeys: ['museum', 'museum'] },
  ])
);

describe('catalog import preparation', () => {
  it('keeps byte source identity distinct from canonical row identity', () => {
    const compact = prepareCatalogImport('static', source);
    const spaced = prepareCatalogImport(
      'static',
      Buffer.from(JSON.stringify(JSON.parse(source.toString()), null, 2))
    );
    expect(compact.manifest.sourceSha256).not.toBe(
      spaced.manifest.sourceSha256
    );
    expect(compact.manifest.canonicalSha256).toBe(
      spaced.manifest.canonicalSha256
    );
    expect(compact.manifest.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces stable canonical ordering, hashes, batches, and map reuse', () => {
    const first = prepareCatalogImport('static', source, [], 1);
    expect(prepareCatalogImport('static', source, [], 1)).toEqual(first);
    const existing = first.mapBatches.flat();
    const repeated = prepareCatalogImport('static', source, existing, 1);
    expect(repeated).toEqual(first);
    expect(first.stagedBatches).toHaveLength(2);
    expect(first.stagedBatches.flat().map((row) => row.legacyKey)).toEqual([
      'museum',
      'walk',
    ]);
  });

  it('quarantines invalid geo and missing or ambiguous references without guessing', () => {
    const result = prepareCatalogImport('static', source);
    expect(result.rejectBatches.flat().map((reject) => reject.code)).toEqual([
      'INVALID_COORDINATES',
      'MISSING_REFERENCE',
      'AMBIGUOUS_REFERENCE',
    ]);
    expect(result.stagedBatches.flat()).toHaveLength(2);
    expect(result.manifest.expectedRows).toBe(5);
  });
});
