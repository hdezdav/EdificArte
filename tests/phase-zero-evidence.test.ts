import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  approvalPayload,
  verifiedEvidenceDigest,
  verifyPhaseZeroReceipt,
} from '../src/lib/migration/phase-zero-evidence';

const temporaryRoots: string[] = [];
const sha256 = (bytes: string) =>
  createHash('sha256').update(bytes).digest('hex');
const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
const keyId = 'test-approver-2026';

interface MutableReceipt extends Record<string, unknown> {
  source: { inventory: Array<Record<string, unknown>> } & Record<
    string,
    unknown
  >;
  exports: Array<Record<string, unknown>>;
  backup?: Record<string, unknown>;
  restoreDrill?: Record<string, unknown>;
  approval?: Record<string, unknown>;
  verifiedEvidenceSha256?: string;
}

async function validFixture() {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'phase-zero-'));
  temporaryRoots.push(fixtureRoot);
  const root = join(fixtureRoot, 'evidence');
  await mkdir(root);
  await mkdir(join(root, 'exports'));
  const places = '{"id":1}\n{"id":2}\n';
  const tours = '{"id":3}\n';
  const backup = places + tours;
  await writeFile(join(root, 'exports/places.ndjson'), places);
  await writeFile(join(root, 'exports/tours.ndjson'), tours);
  await writeFile(join(root, 'backup.ndjson'), backup);
  await writeFile(join(root, 'restore.ndjson'), backup);

  const receipt: MutableReceipt = {
    source: {
      owner: 'Example owner',
      system: 'Example source',
      deployedRuntime: 'example@1',
      deployedSourceIdentity: 'revision-1',
      inventory: [
        { exportId: 'places', expectedRecordCount: 2 },
        { exportId: 'tours', expectedRecordCount: 1 },
      ],
    },
    exports: [
      {
        exportId: 'places',
        artifact: 'exports/places.ndjson',
        sha256: sha256(places),
        recordCount: 2,
      },
      {
        exportId: 'tours',
        artifact: 'exports/tours.ndjson',
        sha256: sha256(tours),
        recordCount: 1,
      },
    ],
    backup: {
      artifact: 'backup.ndjson',
      sha256: sha256(backup),
      recordCount: 3,
      completedAt: '2026-07-22T12:00:00.000Z',
    },
    restoreDrill: {
      successful: true,
      artifact: 'restore.ndjson',
      sha256: sha256(backup),
      recordCount: 3,
      completedAt: '2026-07-22T13:00:00.000Z',
    },
  };
  receipt.verifiedEvidenceSha256 = verifiedEvidenceDigest(receipt);
  const approval = {
    decision: 'approved',
    approver: 'Example approver',
    approvedAt: '2026-07-22T14:00:00.000Z',
    reasons: ['Independent example evidence verified.'],
    keyId,
  };
  receipt.approval = {
    ...approval,
    signature: sign(
      null,
      approvalPayload(receipt.verifiedEvidenceSha256, approval as never),
      keys.privateKey
    ).toString('base64'),
  };
  const receiptPath = join(root, 'receipt.json');
  await writeFile(receiptPath, JSON.stringify(receipt));
  const publicKeyPath = join(root, 'trusted-public-key.pem');
  await writeFile(publicKeyPath, publicKey);
  return { root, receipt, receiptPath, publicKeyPath };
}

function refreshProof(receipt: MutableReceipt) {
  receipt.verifiedEvidenceSha256 = verifiedEvidenceDigest(receipt);
  if (receipt.approval) {
    receipt.approval.signature = sign(
      null,
      approvalPayload(
        receipt.verifiedEvidenceSha256,
        receipt.approval as never
      ),
      keys.privateKey
    ).toString('base64');
  }
}

async function rejectionReasons(
  receipt: MutableReceipt,
  root: string
): Promise<string[]> {
  const validation = await verifyPhaseZeroReceipt(receipt, root, publicKey);
  expect(validation.approved).toBe(false);
  return validation.reasons;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true }))
  );
});

describe('Phase-0 receipt verifier', () => {
  it('proves reachable artifacts, hashes, complete exports, counts, restore, and approval', async () => {
    const { root, receipt } = await validFixture();
    await expect(
      verifyPhaseZeroReceipt(receipt, root, publicKey, keyId)
    ).resolves.toMatchObject({
      approved: true,
      reasons: [],
      counts: { expected: 3, exported: 3, backup: 3, restored: 3 },
    });
  });

  it.each([
    [
      'missing artifact',
      async (r: MutableReceipt) => (r.exports[0].artifact = 'missing'),
    ],
    [
      'hash mismatch',
      async (r: MutableReceipt) => (r.exports[0].sha256 = '0'.repeat(64)),
    ],
    ['incomplete export set', async (r: MutableReceipt) => r.exports.pop()],
    [
      'count mismatch',
      async (r: MutableReceipt) => (r.exports[0].recordCount = 9),
    ],
    [
      'failed restore',
      async (r: MutableReceipt) => (r.restoreDrill!.successful = false),
    ],
    [
      'backup/restore mismatch',
      async (r: MutableReceipt) => (r.restoreDrill!.recordCount = 2),
    ],
  ])('rejects %s', async (_name, mutate) => {
    const { root, receipt } = await validFixture();
    await mutate(receipt);
    expect(
      (await verifyPhaseZeroReceipt(receipt, root, publicKey)).approved
    ).toBe(false);
  });

  it('rejects traversal, absolute paths, and an existing symlink target outside the root', async () => {
    const { root, receipt } = await validFixture();
    receipt.exports[0].artifact = '../outside.ndjson';
    expect(await rejectionReasons(receipt, root)).toContain(
      'Export places artifact is not reachable.'
    );

    receipt.exports[0].artifact = join(root, 'exports/places.ndjson');
    expect(await rejectionReasons(receipt, root)).toContain(
      'Export places path must be a relative path inside the evidence root.'
    );

    const outside = join(root, '../outside.ndjson');
    await writeFile(outside, '{"outside":true}\n');
    await symlink(outside, join(root, 'escape.ndjson'));
    receipt.exports[0].artifact = 'escape.ndjson';
    expect(await rejectionReasons(receipt, root)).toContain(
      'Export places path escapes the evidence root.'
    );
  });

  it('rejects invalid NDJSON even when its actual byte digest is claimed', async () => {
    const { root, receipt } = await validFixture();
    const invalid = '{"id":1}\nnot-json\n';
    await writeFile(join(root, 'exports/places.ndjson'), invalid);
    receipt.exports[0].sha256 = sha256(invalid);
    refreshProof(receipt);
    expect(await rejectionReasons(receipt, root)).toContain(
      'Export places is not valid NDJSON, so its records cannot be counted.'
    );
  });

  it.each([
    [
      'duplicate inventory IDs',
      (r: MutableReceipt) =>
        r.source.inventory.push({ exportId: 'places', expectedRecordCount: 2 }),
      'Inventory export ID places is duplicated.',
    ],
    [
      'duplicate export IDs',
      (r: MutableReceipt) => r.exports.push({ ...r.exports[0] }),
      'Export ID places is duplicated.',
    ],
    [
      'unexpected export IDs',
      (r: MutableReceipt) => (r.exports[0].exportId = 'unexpected'),
      'Export unexpected is not in source inventory.',
    ],
  ])('rejects %s', async (_name, mutate, reason) => {
    const { root, receipt } = await validFixture();
    mutate(receipt);
    refreshProof(receipt);
    expect(await rejectionReasons(receipt, root)).toContain(reason);
  });

  it('rejects a tampered verified evidence digest', async () => {
    const { root, receipt } = await validFixture();
    receipt.verifiedEvidenceSha256 = '0'.repeat(64);
    expect(await rejectionReasons(receipt, root)).toContain(
      'Recorded verified evidence digest does not match the canonical proof payload.'
    );
  });

  it.each([
    [
      'missing backup object',
      (r: MutableReceipt) => delete r.backup,
      'Backup evidence is missing.',
    ],
    [
      'missing restore object',
      (r: MutableReceipt) => delete r.restoreDrill,
      'Restore evidence is missing.',
    ],
    [
      'missing backup artifact',
      (r: MutableReceipt) => (r.backup!.artifact = 'missing-backup.ndjson'),
      'Backup artifact is not reachable.',
    ],
    [
      'missing restore artifact',
      (r: MutableReceipt) =>
        (r.restoreDrill!.artifact = 'missing-restore.ndjson'),
      'Restore artifact is not reachable.',
    ],
  ])('rejects %s', async (_name, mutate, reason) => {
    const { root, receipt } = await validFixture();
    mutate(receipt);
    refreshProof(receipt);
    expect(await rejectionReasons(receipt, root)).toContain(reason);
  });

  it.each([
    ['missing backup timestamp', 'backup', undefined],
    ['invalid backup timestamp', 'backup', 'not-a-date'],
    ['missing restore timestamp', 'restoreDrill', undefined],
    ['invalid restore timestamp', 'restoreDrill', 'not-a-date'],
  ])('rejects %s', async (_name, object, completedAt) => {
    const { root, receipt } = await validFixture();
    const evidence =
      object === 'backup' ? receipt.backup! : receipt.restoreDrill!;
    evidence.completedAt = completedAt;
    refreshProof(receipt);
    const label = object === 'backup' ? 'Backup' : 'Restore';
    expect(await rejectionReasons(receipt, root)).toContain(
      `${label} completion time is unproven.`
    );
  });

  it('rejects backup and restore artifacts with different verified bytes and SHA-256', async () => {
    const { root, receipt } = await validFixture();
    const differentRestore = '{"id":1}\n{"id":2}\n{"id":4}\n';
    await writeFile(join(root, 'restore.ndjson'), differentRestore);
    receipt.restoreDrill!.sha256 = sha256(differentRestore);
    refreshProof(receipt);
    expect(await rejectionReasons(receipt, root)).toContain(
      'Restore artifact does not match the verified backup SHA-256.'
    );
  });

  it('rejects same-count unrelated backup and restore records', async () => {
    const { root, receipt } = await validFixture();
    const unrelated = '{"id":7}\n{"id":8}\n{"id":9}\n';
    await writeFile(join(root, 'backup.ndjson'), unrelated);
    await writeFile(join(root, 'restore.ndjson'), unrelated);
    receipt.backup!.sha256 = sha256(unrelated);
    receipt.restoreDrill!.sha256 = sha256(unrelated);
    refreshProof(receipt);
    expect(await rejectionReasons(receipt, root)).toContain(
      'Backup record content does not reconcile with the verified exports.'
    );
  });

  it('accepts canonical records despite object-key and record reordering', async () => {
    const { root, receipt } = await validFixture();
    const places = '{"name":"one","id":1}\n{"id":2,"name":"two"}\n';
    const tours = '{"nested":{"b":2,"a":1},"id":3}\n';
    const backup =
      '{"id":3,"nested":{"a":1,"b":2}}\n{"name":"two","id":2}\n{"id":1,"name":"one"}\n';
    await writeFile(join(root, 'exports/places.ndjson'), places);
    await writeFile(join(root, 'exports/tours.ndjson'), tours);
    await writeFile(join(root, 'backup.ndjson'), backup);
    await writeFile(join(root, 'restore.ndjson'), backup);
    receipt.exports[0].sha256 = sha256(places);
    receipt.exports[1].sha256 = sha256(tours);
    receipt.backup!.sha256 = sha256(backup);
    receipt.restoreDrill!.sha256 = sha256(backup);
    refreshProof(receipt);
    await expect(
      verifyPhaseZeroReceipt(receipt, root, publicKey, keyId)
    ).resolves.toMatchObject({ approved: true, reasons: [] });
  });

  it('rejects a missing approval', async () => {
    const { root, receipt } = await validFixture();
    delete receipt.approval;
    expect(await rejectionReasons(receipt, root)).toContain(
      'Approval is missing.'
    );
  });

  it('rejects missing approval reasons with an otherwise current signature', async () => {
    const { root, receipt } = await validFixture();
    receipt.approval!.reasons = [];
    refreshProof(receipt);
    expect(await rejectionReasons(receipt, root)).toContain(
      'Approval reasons are missing.'
    );
  });

  it.each([
    ['missing', undefined],
    ['tampered', Buffer.alloc(64).toString('base64')],
  ])('rejects a %s approval signature', async (_name, signature) => {
    const { root, receipt } = await validFixture();
    receipt.approval!.signature = signature;
    expect(await rejectionReasons(receipt, root)).toContain(
      'Approval signature is missing or invalid.'
    );
  });

  it.each(['decision', 'approver', 'approvedAt', 'reasons', 'keyId'])(
    'invalidates the signature when approval %s changes',
    async (field) => {
      const { root, receipt } = await validFixture();
      const approval = receipt.approval!;
      approval[field] = field === 'reasons' ? ['Changed'] : 'changed';
      const validation = await verifyPhaseZeroReceipt(
        receipt,
        root,
        publicKey,
        field === 'keyId' ? 'changed' : undefined
      );
      expect(validation.approved).toBe(false);
      expect(validation.reasons).toContain(
        'Approval signature is missing or invalid.'
      );
    }
  );

  it('rejects malformed receipts without throwing', async () => {
    const { root } = await validFixture();
    await expect(
      verifyPhaseZeroReceipt(null, root, publicKey)
    ).resolves.toMatchObject({
      approved: false,
    });
  });

  it('runs as a deterministic read-only CLI with pass/fail exit codes', async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), 'package.json'), 'utf8')
    );
    expect(packageJson.engines.node).toBe('>=22.18.0 <23');
    const { root, receipt, receiptPath, publicKeyPath } = await validFixture();
    const cli = join(process.cwd(), 'src/lib/migration/phase-zero-evidence.ts');
    const pass = spawnSync(
      process.execPath,
      [cli, receiptPath, root, publicKeyPath, keyId],
      {
        encoding: 'utf8',
      }
    );
    expect(pass.status).toBe(0);
    expect(JSON.parse(pass.stdout)).toMatchObject({
      approved: true,
      schemaVersion: 1,
    });
    const wrongExpectedId = spawnSync(
      process.execPath,
      [cli, receiptPath, root, publicKeyPath, 'changed'],
      { encoding: 'utf8' }
    );
    expect(wrongExpectedId.status).not.toBe(0);
    receipt.approval!.keyId = 'changed';
    await writeFile(receiptPath, JSON.stringify(receipt));
    const changedKeyId = spawnSync(
      process.execPath,
      [cli, receiptPath, root, publicKeyPath, 'changed'],
      { encoding: 'utf8' }
    );
    expect(changedKeyId.status).not.toBe(0);
    expect(JSON.parse(changedKeyId.stdout)).toMatchObject({
      approved: false,
      reasons: expect.arrayContaining([
        'Approval signature is missing or invalid.',
      ]),
    });
    await writeFile(receiptPath, '{bad json');
    const fail = spawnSync(
      process.execPath,
      [cli, receiptPath, root, publicKeyPath],
      {
        encoding: 'utf8',
      }
    );
    expect(fail.status).not.toBe(0);
    expect(JSON.parse(fail.stdout)).toMatchObject({ approved: false });
  });

  it('rejects illustrative receipts and an untrusted signing key', async () => {
    const { root, receipt } = await validFixture();
    receipt.illustrativeOnly = true;
    expect(await rejectionReasons(receipt, root)).toContain(
      'Illustrative receipts cannot be approved.'
    );
    receipt.illustrativeOnly = false;
    const wrongKey = generateKeyPairSync('ed25519').publicKey;
    await expect(
      verifyPhaseZeroReceipt(
        receipt,
        root,
        wrongKey.export({ type: 'spki', format: 'pem' })
      )
    ).resolves.toMatchObject({ approved: false });
    await expect(
      verifyPhaseZeroReceipt(receipt, root, 'not-a-public-key')
    ).resolves.toMatchObject({
      approved: false,
      reasons: expect.arrayContaining([
        'Trusted approval public key is invalid.',
      ]),
    });
  });
});
