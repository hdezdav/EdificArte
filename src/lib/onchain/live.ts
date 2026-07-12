/**
 * Implementación LIVE del adaptador on-chain.
 *
 * Llama a los contratos reales en Polygon mainnet (chainId 137) usando `viem`.
 * Se activa cuando las env vars están configuradas (ver ../onchain/index.ts).
 *
 * IMPORTANTE: Esta implementación NO firma transacciones del lado del server.
 * El usuario (cliente) firma con su propia wallet. El server solo:
 *   1. Llama a `mintBadge()` para acuñar NFTs cuando un usuario gana un badge.
 *      Esto requiere que el server tenga una wallet admin (PRIVATE_KEY +
 *      EDIFICARTE_ADMIN_ADDRESS) configurada. Si no está, la acuñación falla
 *      silenciosamente y se loguea — el usuario sigue teniendo su badge off-chain.
 *   2. Verifica que una tx de pago USDC del cliente es válida.
 *
 * Esto sigue el principio de "el cliente es dueño de sus assets, el server
 * solo certifica".
 */

import {
  createPublicClient,
  http,
  parseEventLogs,
  getAddress,
  type Hash,
  type Hex,
} from 'viem';
import { polygon } from 'viem/chains';
import type {
  BadgeMinter,
  EmitReviewParams,
  MintBadgeParams,
  ReviewEmitter,
  TxResult,
  UsdcTransfer,
  UsdcVerifier,
} from './types';

// ABI mínima del contrato ERC-721 EdificARteBadge.
const BADGE_ABI = [
  {
    name: 'mintBadge',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'badgeId', type: 'uint256' },
      { name: 'tokenURI', type: 'string' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
] as const;

// ABI mínima del contrato de Reviews (solo evento).
const REVIEW_ABI = [
  {
    name: 'ReviewEmitted',
    type: 'event',
    inputs: [
      { name: 'author', type: 'address', indexed: true },
      { name: 'targetType', type: 'string', indexed: false },
      { name: 'targetId', type: 'string', indexed: false },
      { name: 'rating', type: 'uint8', indexed: false },
      { name: 'reviewId', type: 'string', indexed: false },
    ],
  },
] as const;

// ABI mínima del USDC (solo evento Transfer).
const USDC_ABI = [
  {
    name: 'Transfer',
    type: 'event',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const;

function makePublicClient(rpcUrl: string) {
  return createPublicClient({
    chain: polygon,
    transport: http(rpcUrl),
  });
}

/**
 * Mintea un badge NFT. Requiere que el server tenga ADMIN_PRIVATE_KEY
 * configurada. Si no, devuelve un TxResult con mode:'mock' y loguea warning
 * (no rompe el flujo — el badge off-chain ya se guardó en D1).
 */
export class LiveBadgeMinter implements BadgeMinter {
  constructor(
    private rpcUrl: string,
    private badgeContract: `0x${string}`,
    private adminPrivateKey?: `0x${string}`
  ) {}

  async mintBadge(params: MintBadgeParams): Promise<TxResult> {
    if (!this.adminPrivateKey) {
      console.warn(
        '[ONCHAIN LIVE] ADMIN_PRIVATE_KEY no configurada — saltando mint on-chain. ' +
          'El badge queda registrado off-chain en D1.'
      );
      return {
        txHash: '0x' + '0'.repeat(64),
        mode: 'mock',
        emittedAt: new Date().toISOString(),
      };
    }

    // Import dinámico de viem/accounts para no cargar el signer en el bundle
    // del cliente (este código solo corre en el server).
    const { privateKeyToAccount } = await import('viem/accounts');
    const { createWalletClient } = await import('viem');
    const account = privateKeyToAccount(this.adminPrivateKey);

    const client = createWalletClient({
      account,
      chain: polygon,
      transport: http(this.rpcUrl),
    });

    // Construimos un token URI con metadata inline (data URI JSON).
    // Cuando se deploye el contrato, conviene apuntar a IPFS en su lugar.
    const tokenURI =
      'data:application/json;base64,' +
      Buffer.from(JSON.stringify(params.metadata)).toString('base64');

    const txHash = await client.writeContract({
      address: this.badgeContract,
      abi: BADGE_ABI,
      functionName: 'mintBadge',
      args: [getAddress(params.toAddress), BigInt(params.badgeId), tokenURI],
    });

    return {
      txHash,
      mode: 'live',
      emittedAt: new Date().toISOString(),
    };
  }
}

export class LiveReviewEmitter implements ReviewEmitter {
  constructor(private rpcUrl: string) {}

  async emitReview(params: EmitReviewParams): Promise<TxResult> {
    // El evento ReviewEmitted se loguea desde el server cuando se crea
    // una review. No requiere mintear nada nuevo — solo emite un evento
    // indexable en el contrato de reviews.
    //
    // Para que esto funcione end-to-end sin admin key, dejamos el path mock
    // activo cuando ADMIN_PRIVATE_KEY no está seteada. Cuando esté, agregar
    // aquí la llamada writeContract.
    console.warn('[ONCHAIN LIVE] ReviewEmitter.emitReview sin admin key — usando mock fallback');
    return {
      txHash: '0x' + '0'.repeat(64),
      mode: 'mock',
      emittedAt: new Date().toISOString(),
    };
  }
}

/**
 * Verifica una tx de transfer de USDC en Polygon mainnet. Decodifica el
 * log Transfer del contrato USDC y compara contra los valores esperados.
 */
export class LiveUsdcVerifier implements UsdcVerifier {
  constructor(private rpcUrl: string, private usdcContract: `0x${string}`) {}

  async verifyTransfer(args: {
    txHash: string;
    expectedTo: string;
    expectedAmount: string;
  }): Promise<UsdcTransfer | null> {
    const client = makePublicClient(this.rpcUrl);

    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: args.txHash as Hash });
    } catch (err) {
      console.warn('[ONCHAIN LIVE] tx receipt no encontrado:', args.txHash, err);
      return null;
    }

    if (receipt.status !== 'success') return null;

    const logs = parseEventLogs({
      abi: USDC_ABI,
      eventName: 'Transfer',
      logs: receipt.logs,
    });

    const usdcLog = logs.find(
      (l) => (l.address as string).toLowerCase() === this.usdcContract.toLowerCase()
    );

    if (!usdcLog) return null;

    const { from, to, value } = usdcLog.args as {
      from: `0x${string}`;
      to: `0x${string}`;
      value: bigint;
    };

    // Comparación case-insensitive de addresses.
    if (to.toLowerCase() !== getAddress(args.expectedTo).toLowerCase()) return null;
    if (value.toString() !== args.expectedAmount) return null;

    return {
      txHash: args.txHash,
      from,
      to,
      rawAmount: value.toString(),
      confirmations: 1,
    };
  }
}