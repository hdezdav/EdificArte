/**
 * Implementación MOCK del adaptador on-chain.
 *
 * Se usa mientras los contratos Solidity no estén deployados. Devuelve
 * tx hashes fake prefijados con "0xMOCK" para que sean reconocibles, y
 * loguea lo que HARÍA en consola del server.
 *
 * Cuando se deployan los contratos, se setea PUBLIC_BADGE_CONTRACT_ADDRESS
 * (etc.) en wrangler.jsonc vars y el factory elige la implementación live.
 */

import type {
  BadgeMinter,
  EmitReviewParams,
  MintBadgeParams,
  ReviewEmitter,
  TxResult,
  UsdcTransfer,
  UsdcVerifier,
} from './types';

function fakeHash(seed: string): string {
  // Genera un hex determinístico a partir del seed para que el mismo input
  // produzca siempre el mismo hash (útil para idempotencia en demos).
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  let hex = 'MOCK';
  for (let i = 0; i < 13; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    hex += h.toString(16).padStart(8, '0').slice(0, 4);
  }
  return '0x' + hex.slice(0, 64);
}

export class MockBadgeMinter implements BadgeMinter {
  async safeMint(params: MintBadgeParams): Promise<TxResult> {
    const txHash = fakeHash(`badge:${params.toAddress}:${params.badgeId}:${params.metadata.visitedAt}`);
    console.log('[ONCHAIN MOCK] would mint badge', {
      contract: 'EdificARteBadge',
      to: params.toAddress,
      badgeId: params.badgeId,
      metadata: params.metadata,
      txHash,
    });
    return {
      txHash,
      mode: 'mock',
      emittedAt: new Date().toISOString(),
    };
  }
}

export class MockReviewEmitter implements ReviewEmitter {
  async emitReview(params: EmitReviewParams): Promise<TxResult> {
    const txHash = fakeHash(`review:${params.toAddress}:${params.reviewId}`);
    console.log('[ONCHAIN MOCK] would emit review event', {
      contract: 'EdificARteReviews',
      author: params.toAddress,
      targetType: params.targetType,
      targetId: params.targetId,
      rating: params.rating,
      reviewId: params.reviewId,
      txHash,
    });
    return {
      txHash,
      mode: 'mock',
      emittedAt: new Date().toISOString(),
    };
  }
}

/**
 * Mock verifier: confía en lo que dice el cliente. SOLO para desarrollo
 * sin contratos. En live, replace por `LiveUsdcVerifier` que llama al RPC
 * de Polygon y decodifica el log Transfer del USDC.
 *
 * Devuelve siempre un objeto válido — la intención es que el flujo ande
 * end-to-end sin necesidad de tener un RPC público configurado.
 */
export class MockUsdcVerifier implements UsdcVerifier {
  async verifyTransfer(args: {
    txHash: string;
    expectedTo: string;
    expectedAmount: string;
  }): Promise<UsdcTransfer | null> {
    console.log('[ONCHAIN MOCK] trusting client-supplied USDC tx (no on-chain verification)', args);
    return {
      txHash: args.txHash,
      from: '0xMOCK_FROM',
      to: args.expectedTo,
      rawAmount: args.expectedAmount,
      confirmations: 1,
    };
  }
}