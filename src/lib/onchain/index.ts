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
import {
  MockBadgeMinter,
  MockReviewEmitter,
  MockUsdcVerifier,
} from './mock';
import {
  LiveBadgeMinter,
  LiveReviewEmitter,
  LiveUsdcVerifier,
} from './live';

export interface OnchainEnv {
  PUBLIC_BADGE_CONTRACT_ADDRESS?: string;
  PUBLIC_REVIEW_CONTRACT_ADDRESS?: string;
  USDC_CONTRACT_ADDRESS?: string;
  EDIFICARTE_PAYMENT_ADDRESS?: string;
  POLYGON_RPC_URL?: string;
  ADMIN_PRIVATE_KEY?: string;
}

/**
 * Detecta si hay configuración suficiente para correr en modo live.
 * Si falta cualquiera de las env vars críticas, devuelve false.
 */
export function isLiveMode(env: OnchainEnv): boolean {
  return Boolean(
    env.PUBLIC_BADGE_CONTRACT_ADDRESS &&
      env.POLYGON_RPC_URL &&
      env.ADMIN_PRIVATE_KEY
  );
}

export function getBadgeMinter(env: OnchainEnv): BadgeMinter {
  if (!isLiveMode(env)) return new MockBadgeMinter();
  return new LiveBadgeMinter(
    env.POLYGON_RPC_URL!,
    env.PUBLIC_BADGE_CONTRACT_ADDRESS! as `0x${string}`,
    env.ADMIN_PRIVATE_KEY as `0x${string}` | undefined
  );
}

export function getReviewEmitter(env: OnchainEnv): ReviewEmitter {
  if (!isLiveMode(env)) return new MockReviewEmitter();
  return new LiveReviewEmitter(env.POLYGON_RPC_URL!);
}

/**
 * El verificador de USDC usa USDC_CONTRACT_ADDRESS en vez de PUBLIC_BADGE_*.
 * Eso permite que los pagos USDC funcionen en live aunque los badges aún
 * no estén deployados (caso común durante el rollout).
 */
export function getUsdcVerifier(env: OnchainEnv): UsdcVerifier {
  if (!env.USDC_CONTRACT_ADDRESS || !env.POLYGON_RPC_URL) {
    return new MockUsdcVerifier();
  }
  return new LiveUsdcVerifier(
    env.POLYGON_RPC_URL,
    env.USDC_CONTRACT_ADDRESS as `0x${string}`
  );
}

export * from './types';