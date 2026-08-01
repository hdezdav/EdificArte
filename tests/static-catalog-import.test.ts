import { readFile } from 'node:fs/promises';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MONUMENTS } from '../src/data/monuments';
import {
  adaptStaticCatalog,
  buildStaticCatalogPlan,
  deterministicEvidence,
  generateStaticCatalogArtifacts,
  STATIC_CATALOG_EVIDENCE_PATH,
  STATIC_CATALOG_SOURCE,
  STATIC_CATALOG_SQL_PATH,
} from '../scripts/import/static-catalog';

describe('first static catalog import plan', () => {
  it('adapts all monuments to deterministic draft place rows and translations', () => {
    const rows = adaptStaticCatalog();
    expect(rows).toHaveLength(9);
    expect(rows.flatMap((row) => row.translations)).toHaveLength(18);
    expect(rows.every((row) => row.type === 'place')).toBe(true);
    expect(rows.every((row) => row.publicationState === 'draft')).toBe(true);
    rows.forEach((row, index) => {
      expect(row.coordinates).toEqual([
        MONUMENTS[index].lng,
        MONUMENTS[index].lat,
      ]);
      expect(row.translations.map(({ locale }) => locale)).toEqual([
        'en',
        'es',
      ]);
      expect(row.source).toEqual(MONUMENTS[index]);
    });
  });

  it('produces stable hashes, IDs, SQL, and retry-equivalent plans', () => {
    const first = buildStaticCatalogPlan();
    expect(buildStaticCatalogPlan()).toEqual(first);
    expect(first.plan.manifest.sourceName).toBe(STATIC_CATALOG_SOURCE);
    expect(first.plan.manifest.expectedRows).toBe(9);
    expect(first.plan.rejectBatches.flat()).toEqual([]);
    expect(first.plan.mapBatches.flat()).toHaveLength(9);
    expect(first.evidence.sql.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.sql).toContain('pg_advisory_xact_lock');
    expect(first.sql).toContain('catalog_import.finalize_run');
    expect(first.sql).not.toContain(
      "publication_state = 'draft', published_at"
    );
    expect(first.sql).toContain('m.first_run_id=c.run_id))');
    expect(first.sql).not.toMatch(/import_runs\(id|random_uuid/i);
  });

  it('preserves publication on retry and reports only maps created by this run', () => {
    const { sql } = buildStaticCatalogPlan();
    expect(sql).not.toMatch(/do update set[\s\S]{0,150}publication_state/);
    expect(sql).toContain('s.legacy_key is null or m.legacy_key is null');
    expect(sql).toContain('s.legacy_key is null or p.legacy_key is null');
    expect(sql).not.toContain(', 9, 0, 9)');
    expect(sql).toContain("'mapped_count', q.mapped_count");
  });

  it('reuses stable maps for a changed source hash', () => {
    const first = buildStaticCatalogPlan();
    const changed = structuredClone(MONUMENTS);
    changed[0].desc += ' Updated.';
    const existingMaps = first.plan.mapBatches.flat();
    existingMaps[0].catalogId = '11111111-1111-5111-8111-111111111111';
    const next = buildStaticCatalogPlan(changed, existingMaps);
    expect(next.plan.manifest.sourceSha256).not.toBe(
      first.plan.manifest.sourceSha256
    );
    expect(next.plan.mapBatches).toEqual([existingMaps]);
    expect(next.sql).toContain(
      'on conflict (source_name, entity_type, legacy_key) do nothing'
    );
  });

  it('rejects incomplete locale content before planning', () => {
    const incomplete = structuredClone(MONUMENTS);
    incomplete[0].translations!.es!.desc = '';
    expect(() => adaptStaticCatalog(incomplete)).toThrow(
      'bellas-artes is missing es name or description'
    );
  });

  it('keeps generated SQL and deterministic evidence current', async () => {
    const result = buildStaticCatalogPlan();
    expect(await readFile(STATIC_CATALOG_SQL_PATH, 'utf8')).toBe(result.sql);
    const evidence = JSON.parse(
      await readFile(STATIC_CATALOG_EVIDENCE_PATH, 'utf8')
    );
    expect(deterministicEvidence(evidence)).toEqual(
      deterministicEvidence(result.evidence)
    );
    expect(evidence.executionStatus).toBe('executed');
    expect({
      receipt: evidence.receipt,
      actual: evidence.reconciliation.actual,
    }).toEqual(
      JSON.parse(
        '{"receipt":{"runId":"55992713-cada-48d0-814c-44d4fdb75137","sourceSha256":"a7254b4d689b708e04ffad8af08565a35b44fca17e05a32e94eae252a7b8bb5e","canonicalSha256":"e1632c5efe4fc27114a5cc1911dddd96eb75382286ee539694671967792af9db","accepted":9,"rejected":0,"mapped":9},"actual":{"staged":9,"rejected":0,"mapped":9,"places":9,"translations":18,"draft":9,"idParityMismatches":0,"coordinateMismatches":0,"unsupportedFieldsPreserved":9}}'
      )
    );
  });

  it('preserves an executed receipt and rejects deterministic drift', async () => {
    const root = await mkdtemp(join(tmpdir(), 'itmap-catalog-'));
    const path = join(root, STATIC_CATALOG_EVIDENCE_PATH);
    const executed = JSON.parse(
      await readFile(STATIC_CATALOG_EVIDENCE_PATH, 'utf8')
    );
    try {
      await generateStaticCatalogArtifacts(root);
      await writeFile(path, `${JSON.stringify(executed)}\n`);
      await generateStaticCatalogArtifacts(root);
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(executed);
      executed.manifest.expectedRows = 10;
      await writeFile(path, `${JSON.stringify(executed)}\n`);
      await expect(generateStaticCatalogArtifacts(root)).rejects.toThrow(
        'deterministic drift'
      );
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(executed);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
