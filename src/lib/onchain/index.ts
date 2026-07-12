/**
 * Factory de adaptadores on-chain.
 *
 * Elige la implementación (mock vs live) según las env vars:
 *   - LIVE si PUBLIC_BADGE_CONTRACT_ADDRESS está seteada y ADMIN_PRIVATE_KEY también.
 *   - MOCK en cualquier otro caso (desarrollo, pre-deploy).
 *
 * Las funciones devuelven siempre la misma interfaz, así el código que las
 * usa no se entera de qué implementación está activa.
 */

import type { BadgeMinter, ReviewEmitter, UsdcVerifier } from './types';
import { MockBadgeMinter, MockReviewEmitter } from './mock';
import {
  LiveBadgeMinter,
  LiveReviewEmitter,
  LiveUsdcVerifier,
} from './live';

/**
 * Subset de `Env` que el factory on-chain necesita.
 *
 * Tipado estructural: coincide con el `Env` global declarado en
 * `worker-configuration.d.ts` / `src/env.d.ts`, así las API routes
 * pueden pasar `locals.runtime.env` directamente sin cast.
 *
 * POLYGON_RPC_URL es opcional (puede faltar si ALCHEMY_KEY está
 * disponible — `getRpcUrl()` resuelve la URL en runtime).
 */
export interface OnchainEnv {
  USDC_CONTRACT_ADDRESS: string;
  POLYGON_RPC_URL?: string;
  PUBLIC_BADGE_CONTRACT_ADDRESS?: string;
  PUBLIC_REVIEW_CONTRACT_ADDRESS?: string;
  EDIFICARTE_PAYMENT_ADDRESS?: string;
  EDIFICARTE_DONATION_ADDRESS?: string;
  ADMIN_PRIVATE_KEY?: string;
  ALCHEMY_KEY?: string;
}

/**
 * Resuelve la URL del RPC de Polygon en runtime.
 *
 * Prioridad:
 *   1. ALCHEMY_KEY (si está seteada) → Alchemy Polygon mainnet
 *   2. POLYGON_RPC_URL (fallback)
 *
 * Lanza error si ninguna está configurada (el caller no debería llegar
 * acá sin configurar el RPC).
 */
export function getRpcUrl(env: OnchainEnv): string {
  if (env.ALCHEMY_KEY) {
    return `https://polygon-mainnet.g.alchemy.com/v2/${env.ALCHEMY_KEY}`;
  }
  if (env.POLYGON_RPC_URL) {
    return env.POLYGON_RPC_URL;
  }
  throw new Error(
    'No hay RPC configurado. Setear ALCHEMY_KEY (recomendado) o POLYGON_RPC_URL en el env.'
  );
}

/**
 * Detecta si hay configuración suficiente para correr en modo live.
 * Si falta cualquiera de las env vars críticas, devuelve false.
 *
 * Requiere AMBAS contract addresses (badge + reviews) + RPC (resuelto
 * por getRpcUrl) + admin key.
 */
export function isLiveMode(env: OnchainEnv): boolean {
  let rpcOk = false;
  try {
    getRpcUrl(env);
    rpcOk = true;
  } catch {
    rpcOk = false;
  }
  return Boolean(
    env.PUBLIC_BADGE_CONTRACT_ADDRESS &&
      env.PUBLIC_REVIEW_CONTRACT_ADDRESS &&
      rpcOk &&
      env.ADMIN_PRIVATE_KEY
  );
}

export function getBadgeMinter(env: OnchainEnv): BadgeMinter {
  if (!isLiveMode(env)) return new MockBadgeMinter();
  return new LiveBadgeMinter(
    getRpcUrl(env),
    env.PUBLIC_BADGE_CONTRACT_ADDRESS! as `0x${string}`,
    env.ADMIN_PRIVATE_KEY as `0x${string}` | undefined
  );
}

/**
 * Emitter de reviews. Si falta `PUBLIC_REVIEW_CONTRACT_ADDRESS`, cae a mock.
 * Si está la address pero falta `ADMIN_PRIVATE_KEY`, también cae a mock
 * (necesitamos una wallet que firme el emit desde el server).
 */
export function getReviewEmitter(env: OnchainEnv): ReviewEmitter {
  if (!isLiveMode(env)) return new MockReviewEmitter();
  return new LiveReviewEmitter(
    getRpcUrl(env),
    env.PUBLIC_REVIEW_CONTRACT_ADDRESS! as `0x${string}`,
    env.ADMIN_PRIVATE_KEY as `0x${string}` | undefined
  );
}

/**
 * Devuelve el verificador USDC.
 *
 * Como USDC_CONTRACT_ADDRESS es requerida en `Env`, asumimos que siempre
 * está presente. El RPC se resuelve via `getRpcUrl()`.
 */
export function getUsdcVerifier(env: OnchainEnv): UsdcVerifier {
  return new LiveUsdcVerifier(
    getRpcUrl(env),
    env.USDC_CONTRACT_ADDRESS as `0x${string}`
  );
}

export * from './types';