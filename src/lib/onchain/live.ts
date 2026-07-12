/**
 * Implementación LIVE del adaptador on-chain.
 *
 * Llama a los contratos reales en Polygon mainnet (chainId 137) usando `viem`.
 * Se activa cuando las env vars están configuradas (ver ../onchain/index.ts).
 *
 * IMPORTANTE: Esta implementación NO firma transacciones del lado del server.
 * El usuario (cliente) firma con su propia wallet. El server solo:
 *   1. Llama a `safeMint()` para acuñar NFTs cuando un usuario gana un badge.
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
// Renombrado de mintBadge → safeMint (alineado con el baseline de OZ 5.x;
// el nombre original hacía shadowing con la función tokenURI que también
// es virtual en OZ 5.x).
const BADGE_ABI = [
  {
    name: 'safeMint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'badgeId', type: 'uint256' },
      { name: 'uri', type: 'string' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
] as const;

// ABI mínima del contrato de Reviews (evento + función emitReview).
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
  {
    name: 'emitReview',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'author', type: 'address' },
      { name: 'targetType', type: 'string' },
      { name: 'targetId', type: 'string' },
      { name: 'rating', type: 'uint8' },
      { name: 'reviewId', type: 'string' },
    ],
    outputs: [],
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

  async safeMint(params: MintBadgeParams): Promise<TxResult> {
    if (!this.adminPrivateKey) {
      console.warn(
        '[ONCHAIN LIVE] ADMIN_PRIVATE_KEY no configurada — saltando mint on-chain. ' +
          'El badge queda registrado off-chain en D1.'
      );
      // Devolvemos string vacío en vez de un hash zero real para no
      // persistir hashes engañosos en user_badges.tx_hash (D1).
      return {
        txHash: '',
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
    // Cuando se deploye el contrato, conviene apuntar a IPFS en su lugar
    // (un data URI JSON cuesta ~50k gas extra por mint).
    //
    // Usamos btoa() con escape para no depender de `Buffer` (no tipado
    // en este proyecto y solo disponible en runtime por nodejs_compat,
    // no en el type-check local).
    const metadataJson = JSON.stringify(params.metadata);
    const tokenURI =
      'data:application/json;base64,' +
      btoa(unescape(encodeURIComponent(metadataJson)));

    const txHash = await client.writeContract({
      address: this.badgeContract,
      abi: BADGE_ABI,
      functionName: 'safeMint',
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
  constructor(
    private rpcUrl: string,
    private reviewContract: `0x${string}`,
    private adminPrivateKey?: `0x${string}`
  ) {}

  async emitReview(params: EmitReviewParams): Promise<TxResult> {
    // Si falta el contrato deployado o la admin key, caemos a mock
    // (mismo patrón que LiveBadgeMinter). La review off-chain en D1 queda
    // persistida — el cliente solo no recibe prueba on-chain.
    if (!this.adminPrivateKey) {
      console.warn(
        '[ONCHAIN LIVE] ADMIN_PRIVATE_KEY no configurada — emit quedaría mock. ' +
          'La review queda registrada off-chain en D1.'
      );
      return {
        txHash: '',
        mode: 'mock',
        emittedAt: new Date().toISOString(),
      };
    }

    // Import dinámico de viem/accounts (este código solo corre server-side).
    const { privateKeyToAccount } = await import('viem/accounts');
    const { createWalletClient } = await import('viem');
    const account = privateKeyToAccount(this.adminPrivateKey);

    const client = createWalletClient({
      account,
      chain: polygon,
      transport: http(this.rpcUrl),
    });

    const txHash = await client.writeContract({
      address: this.reviewContract,
      abi: REVIEW_ABI,
      functionName: 'emitReview',
      args: [
        getAddress(params.toAddress),
        params.targetType,
        params.targetId,
        params.rating,
        params.reviewId,
      ],
    });

    return {
      txHash,
      mode: 'live',
      emittedAt: new Date().toISOString(),
    };
  }
}

/**
 * Verifica una tx de transfer de USDC en Polygon mainnet. Decodifica el
 * log Transfer del contrato USDC y compara contra los valores esperados.
 */
export class LiveUsdcVerifier implements UsdcVerifier {
  /**
   * Mínimo de confirmaciones requeridas para dar un pago por válido.
   *
   * Polygon mainnet tiene blocktime ~2s y reorgs pequeños son posibles.
   * 64 confirmaciones ≈ 2 min, suficiente en la práctica para e-commerce
   * (un usuario no espera 2 min en el checkout, pero el webhook/pedido
   * puede confirmar de forma asíncrona).
   *
   * Si bajás este número, aumentás el riesgo de aceptar pagos que
   * posteriormente se revierten (reorg). Si lo subís, aumentás la
   * latencia de confirmación.
   */
  private static readonly MIN_CONFIRMATIONS = 64;

  constructor(private rpcUrl: string, private usdcContract: `0x${string}`) {}

  async verifyTransfer(args: {
    txHash: string;
    expectedTo: string;
    expectedAmount: string;
  }): Promise<UsdcTransfer | null> {
    const client = makePublicClient(this.rpcUrl);

    // Distinguimos "tx no encontrada" (aún no minteada / hash inválido) de
    // "RPC caído / error de red". El primero le dice al cliente "esperá";
    // el segundo es un problema del server y debería ser 500, no 400.
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: args.txHash as Hash });
    } catch (err) {
      console.warn('[ONCHAIN LIVE] tx receipt no encontrado:', args.txHash, err);
      return null;
    }

    if (receipt.status !== 'success') return null;

    // Chequeo de confirmaciones contra la chain actual. Polygon puede
    // reorganizar bloques pequeños, así que exigir MIN_CONFIRMATIONS
    // evita aceptar pagos que después se revierten.
    let currentBlock: bigint;
    try {
      currentBlock = await client.getBlockNumber();
    } catch (err) {
      console.warn('[ONCHAIN LIVE] RPC error al obtener blockNumber:', err);
      return null;
    }
    const confirmations = Number(currentBlock - receipt.blockNumber) + 1;
    if (confirmations < LiveUsdcVerifier.MIN_CONFIRMATIONS) {
      console.info(
        `[ONCHAIN LIVE] tx ${args.txHash} tiene ${confirmations} confirmaciones, ` +
          `esperando ${LiveUsdcVerifier.MIN_CONFIRMATIONS}.`
      );
      return null;
    }

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
      confirmations,
    };
  }
}