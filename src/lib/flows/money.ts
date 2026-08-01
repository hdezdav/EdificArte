// Centralized MXN ↔ USDC conversion (single source of truth — replaces
// the duplicated 17.0 constants in index.astro and tienda.astro).
export const MXN_PER_USDC = 17;

export function mxnToUsdc(mxn: number): number {
  return mxn / MXN_PER_USDC;
}

export function formatMxn(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatUsdc(amount: number, opts: { max?: number } = {}): string {
  const { max = 4 } = opts;
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: max,
  }).format(amount);
}

// USDC has 6 decimals on Polygon — convert a display amount to bigint-string.
export function toUsdcRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000));
}

export function fromUsdcRaw(raw: string | bigint): number {
  return Number(BigInt(raw.toString())) / 1_000_000;
}

// Payment receiver address. Fallback matches the old hardcoded values so we
// don't break anything during migration.
export function getPaymentAddress(
  env: { TURIMAP_PAYMENT_ADDRESS?: string } | undefined
): string {
  return (
    env?.TURIMAP_PAYMENT_ADDRESS ||
    '0xD540067d763bc792b81f816a677bB25d7e6d4B0B'
  );
}
