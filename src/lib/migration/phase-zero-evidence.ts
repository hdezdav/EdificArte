import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type JsonRecord = Record<string, unknown>;

interface ApprovalMetadata {
  decision: unknown;
  approver: unknown;
  approvedAt: unknown;
  reasons: unknown;
  keyId: unknown;
  signature: unknown;
}

export interface EvidenceValidation {
  schemaVersion: 1;
  approved: boolean;
  reasons: string[];
  verifiedEvidenceSha256: string;
  approvalKeyId: string;
  counts: {
    expected: number;
    exported: number;
    backup: number;
    restored: number;
  };
}

const SHA256 = /^[a-f0-9]{64}$/;
const EMPTY_COUNTS = { expected: 0, exported: 0, backup: 0, restored: 0 };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function present(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function timestamp(value: unknown): value is string {
  return present(value) && !Number.isNaN(Date.parse(value));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** Hashes only proof claims. Approval and digest fields are deliberately excluded. */
export function verifiedEvidenceDigest(value: unknown): string {
  if (!isRecord(value)) return '';
  const payload = { ...value };
  delete payload.approval;
  delete payload.verifiedEvidenceSha256;
  return digest(payload);
}

/** Canonical bytes signed by the independently trusted approval key. */
export function approvalPayload(
  verifiedEvidenceSha256: unknown,
  approval: ApprovalMetadata
): Buffer {
  const payload = {
    verifiedEvidenceSha256,
    decision: approval.decision,
    approver: approval.approver,
    approvedAt: approval.approvedAt,
    reasons: approval.reasons,
    keyId: approval.keyId,
  };
  return Buffer.from(canonicalJson(payload));
}

function result(
  reasons: string[],
  evidence = '',
  keyId = '',
  counts = EMPTY_COUNTS
) {
  return {
    schemaVersion: 1 as const,
    approved: reasons.length === 0,
    reasons,
    verifiedEvidenceSha256: evidence,
    approvalKeyId: keyId,
    counts,
  };
}

async function artifactBytes(
  root: string,
  artifact: unknown,
  label: string,
  reasons: string[]
): Promise<Buffer | undefined> {
  if (!present(artifact) || isAbsolute(artifact)) {
    reasons.push(
      `${label} path must be a relative path inside the evidence root.`
    );
    return;
  }
  try {
    const rootPath = await realpath(root);
    const artifactPath = await realpath(resolve(rootPath, artifact));
    const escape = relative(rootPath, artifactPath);
    if (escape.startsWith('..') || isAbsolute(escape)) {
      reasons.push(`${label} path escapes the evidence root.`);
      return;
    }
    return await readFile(artifactPath);
  } catch {
    reasons.push(`${label} artifact is not reachable.`);
  }
}

function ndjsonDigests(bytes: Buffer): string[] | undefined {
  const lines = bytes
    .toString('utf8')
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0);
  try {
    return lines.map((line) => digest(JSON.parse(line)));
  } catch {
    return undefined;
  }
}

async function verifyArtifact(
  root: string,
  item: JsonRecord,
  label: string,
  reasons: string[]
): Promise<{ count: number; digests: string[] }> {
  const bytes = await artifactBytes(root, item.artifact, label, reasons);
  if (!bytes) return { count: 0, digests: [] };
  const actualSha = createHash('sha256').update(bytes).digest('hex');
  if (
    !present(item.sha256) ||
    !SHA256.test(item.sha256) ||
    item.sha256 !== actualSha
  )
    reasons.push(`${label} SHA-256 does not match its actual bytes.`);
  const digests = ndjsonDigests(bytes);
  if (digests === undefined) {
    reasons.push(
      `${label} is not valid NDJSON, so its records cannot be counted.`
    );
    return { count: 0, digests: [] };
  }
  const actualCount = digests.length;
  if (!count(item.recordCount) || item.recordCount !== actualCount)
    reasons.push(
      `${label} claimed record count does not match its NDJSON records.`
    );
  return { count: actualCount, digests };
}

export async function verifyPhaseZeroReceipt(
  value: unknown,
  evidenceRoot: string,
  trustedPublicKey: string | Buffer,
  expectedKeyId?: string
): Promise<EvidenceValidation> {
  const reasons: string[] = [];
  if (!isRecord(value)) return result(['Receipt must be an object.']);
  if (value.illustrativeOnly === true)
    reasons.push('Illustrative receipts cannot be approved.');
  const source = value.source;
  if (!isRecord(source)) return result(['Source inventory is missing.']);
  for (const [key, label] of [
    ['owner', 'owner'],
    ['system', 'system'],
    ['deployedRuntime', 'deployed runtime'],
    ['deployedSourceIdentity', 'deployed source identity'],
  ] as const) {
    if (!present(source[key])) reasons.push(`Source ${label} is unproven.`);
  }

  const inventory = source.inventory;
  const exports = value.exports;
  const expected = new Map<string, number>();
  if (!Array.isArray(inventory) || inventory.length === 0) {
    reasons.push('Source inventory and expected export set are missing.');
  } else {
    inventory.forEach((entry, index) => {
      if (
        !isRecord(entry) ||
        !present(entry.exportId) ||
        !count(entry.expectedRecordCount)
      ) {
        reasons.push(`Inventory ${index + 1} is malformed.`);
      } else if (expected.has(entry.exportId)) {
        reasons.push(`Inventory export ID ${entry.exportId} is duplicated.`);
      } else expected.set(entry.exportId, entry.expectedRecordCount);
    });
  }

  let exportedCount = 0;
  const exportedDigests: string[] = [];
  const exportedIds = new Set<string>();
  if (!Array.isArray(exports) || exports.length === 0) {
    reasons.push('Export set is missing.');
  } else {
    for (const [index, entry] of exports.entries()) {
      if (!isRecord(entry) || !present(entry.exportId)) {
        reasons.push(`Export ${index + 1} is malformed.`);
        continue;
      }
      if (exportedIds.has(entry.exportId))
        reasons.push(`Export ID ${entry.exportId} is duplicated.`);
      exportedIds.add(entry.exportId);
      const artifact = await verifyArtifact(
        evidenceRoot,
        entry,
        `Export ${entry.exportId}`,
        reasons
      );
      const actual = artifact.count;
      exportedCount += actual;
      exportedDigests.push(...artifact.digests);
      if (!expected.has(entry.exportId))
        reasons.push(`Export ${entry.exportId} is not in source inventory.`);
      else if (expected.get(entry.exportId) !== actual)
        reasons.push(
          `Export ${entry.exportId} does not match its expected source count.`
        );
    }
  }
  for (const id of expected.keys())
    if (!exportedIds.has(id)) reasons.push(`Expected export ${id} is missing.`);

  const backup = value.backup;
  const restore = value.restoreDrill;
  let backupCount = 0;
  let restoredCount = 0;
  let backupDigests: string[] = [];
  if (!isRecord(backup)) reasons.push('Backup evidence is missing.');
  else {
    if (!timestamp(backup.completedAt))
      reasons.push('Backup completion time is unproven.');
    const artifact = await verifyArtifact(
      evidenceRoot,
      backup,
      'Backup',
      reasons
    );
    backupCount = artifact.count;
    backupDigests = artifact.digests;
  }
  if (!isRecord(restore)) reasons.push('Restore evidence is missing.');
  else {
    if (restore.successful !== true)
      reasons.push('Restore drill did not explicitly succeed.');
    if (!timestamp(restore.completedAt))
      reasons.push('Restore completion time is unproven.');
    restoredCount = (
      await verifyArtifact(evidenceRoot, restore, 'Restore', reasons)
    ).count;
  }

  const expectedCount = [...expected.values()].reduce(
    (sum, item) => sum + item,
    0
  );
  const counts = {
    expected: expectedCount,
    exported: exportedCount,
    backup: backupCount,
    restored: restoredCount,
  };
  if (new Set(Object.values(counts)).size !== 1)
    reasons.push(
      'Expected, exported, backup, and restored record totals do not reconcile.'
    );
  if (exportedDigests.sort().join('\n') !== backupDigests.sort().join('\n'))
    reasons.push(
      'Backup record content does not reconcile with the verified exports.'
    );
  if (isRecord(backup) && isRecord(restore) && backup.sha256 !== restore.sha256)
    reasons.push(
      'Restore artifact does not match the verified backup SHA-256.'
    );

  const evidenceSha = verifiedEvidenceDigest(value);
  if (value.verifiedEvidenceSha256 !== evidenceSha)
    reasons.push(
      'Recorded verified evidence digest does not match the canonical proof payload.'
    );
  const approval = value.approval;
  let keyId = '';
  if (!isRecord(approval)) reasons.push('Approval is missing.');
  else {
    const metadata = approval as unknown as ApprovalMetadata;
    keyId = present(approval.keyId) ? approval.keyId : '';
    if (approval.decision !== 'approved')
      reasons.push('Approval decision is not approved.');
    if (!present(approval.approver) || !timestamp(approval.approvedAt))
      reasons.push('Approval actor or time is unproven.');
    if (
      !Array.isArray(approval.reasons) ||
      approval.reasons.length === 0 ||
      approval.reasons.some((reason) => !present(reason))
    )
      reasons.push('Approval reasons are missing.');
    if (!keyId || (expectedKeyId !== undefined && keyId !== expectedKeyId))
      reasons.push('Approval signer key ID is missing or is not trusted.');
    try {
      if (
        !present(approval.signature) ||
        !verify(
          null,
          approvalPayload(evidenceSha, metadata),
          createPublicKey(trustedPublicKey),
          Buffer.from(approval.signature, 'base64')
        )
      )
        reasons.push('Approval signature is missing or invalid.');
    } catch {
      reasons.push('Trusted approval public key is invalid.');
    }
  }
  return result(reasons, evidenceSha, keyId, counts);
}

async function runCli(args: string[]) {
  let output: EvidenceValidation;
  try {
    if (args.length < 3 || args.length > 4)
      throw new Error(
        'Usage: phase-zero-evidence <receipt.json> <evidence-root> <trusted-public-key.pem> [expected-key-id]'
      );
    const [receiptPath, root, publicKeyPath, expectedKeyId] = args;
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as unknown;
    const trustedPublicKey = await readFile(publicKeyPath);
    output = await verifyPhaseZeroReceipt(
      receipt,
      root,
      trustedPublicKey,
      expectedKeyId
    );
  } catch (error) {
    output = result([
      error instanceof Error ? error.message : 'Receipt verification failed.',
    ]);
  }
  process.stdout.write(`${canonicalJson(output)}\n`);
  process.exitCode = output.approved ? 0 : 1;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await runCli(process.argv.slice(2));
