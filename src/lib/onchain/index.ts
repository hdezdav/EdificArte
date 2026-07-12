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
 * Mantenemos USDC_CONTRACT_ADDRESS y POLYGON_RPC_URL como requeridas
 * (igual que en Env). Si en algún momento se quiere permitir modo mock
 * sin esas vars, usar `Partial<OnchainEnv>` en el call site.
 */
export interface OnchainEnv {
  USDC_CONTRACT_ADDRESS: string;
  POLYGON_RPC_URL: string;
  PUBLIC_BADGE_CONTRACT_ADDRESS?: string;
  PUBLIC_REVIEW_CONTRACT_ADDRESS?: string;
  EDIFICARTE_PAYMENT_ADDRESS?: string;
  ADMIN_PRIVATE_KEY?: string;
}

/**
 * Detecta si hay configuración suficiente para correr en modo live.
 * Si falta cualquiera de las env vars críticas, devuelve false.
 *
 * Requiere AMBAS contract addresses (badge + reviews) + RPC + admin key.
 * Esto es estricto: cualquier var faltante hace caer todo a Mock.
 * Si querés rollout por fases (ej. badges en live + reviews en mock),
 * usá `getBadgeMinter` / `getReviewEmitter` directos con vars parciales.
 */
export function isLiveMode(env: OnchainEnv): boolean {
  return Boolean(
    env.PUBLIC_BADGE_CONTRACT_ADDRESS &&
      env.PUBLIC_REVIEW_CONTRACT_ADDRESS &&
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

/**
 * Emitter de reviews. Si falta `PUBLIC_REVIEW_CONTRACT_ADDRESS`, cae a mock.
 * Si está la address pero falta `ADMIN_PRIVATE_KEY`, también cae a mock
 * (necesitamos una wallet que firme el emit desde el server).
 */
export function getReviewEmitter(env: OnchainEnv): ReviewEmitter {
  if (!isLiveMode(env)) return new MockReviewEmitter();
  return new LiveReviewEmitter(
    env.POLYGON_RPC_URL!,
    env.PUBLIC_REVIEW_CONTRACT_ADDRESS! as `0x${string}`,
    env.ADMIN_PRIVATE_KEY as `0x${string}` | undefined
  );
}

/**
 * Devuelve el verificador USDC.
 *
 * Como USDC_CONTRACT_ADDRESS y POLYGON_RPC_URL son requeridas en `Env`
 * (están en wrangler.jsonc vars con defaults), asumimos que siempre
 * están presentes. Si el caller quiere modo mock para payments,
 * que no llame a esta función y use el Mock directo.
 */
export function getUsdcVerifier(env: OnchainEnv): UsdcVerifier {
  return new LiveUsdcVerifier(
    env.POLYGON_RPC_URL,
    env.USDC_CONTRACT_ADDRESS as `0x${string}`
  );
}

export * from './types';