/**
 * Tipos del adaptador on-chain.
 *
 * La idea es que el resto de la app (API endpoints, UI) hable solo contra
 * estas interfaces. La implementación concreta (mock vs live) se elige en
 * el factory `index.ts` según las env vars.
 *
 * Mock = todo off-chain, simulamos tx hashes. Se usa durante desarrollo y
 * hasta que el usuario deploye los contratos Solidity.
 *
 * Live = llama a los contratos reales en Polygon mainnet vía RPC público.
 * Requiere: PUBLIC_BADGE_CONTRACT_ADDRESS, USDC_CONTRACT_ADDRESS,
 * EDIFICARTE_PAYMENT_ADDRESS, POLYGON_RPC_URL.
 */

export type ChainId = 137; // Polygon mainnet

export interface MintBadgeParams {
  /** Address EVM del destinatario (0x…). */
  toAddress: string;
  /** ID del badge off-chain (coincide con badgeId de user_badges en D1). */
  badgeId: number;
  /** Metadata que se almacena en el token URI del NFT. */
  metadata: {
    name: string;
    description: string;
    image: string;
    monumentId: string;
    visitedAt: string; // ISO
  };
}

export interface EmitReviewParams {
  toAddress: string;
  targetType: 'museum' | 'product' | 'tour';
  targetId: string;
  rating: number; // 1-5
  reviewId: string; // uuid de la review en D1
}

export interface TxResult {
  txHash: string;
  /** 'mock' hasta que los contratos estén deployados; 'live' después. */
  mode: 'mock' | 'live';
  /** Timestamp ISO en que se emitió la tx (real o simulada). */
  emittedAt: string;
}

export interface UsdcTransfer {
  /** Hash de la tx en Polygon. */
  txHash: string;
  /** Address que envió el USDC (el cliente). */
  from: string;
  /** Debe coincidir con EDIFICARTE_PAYMENT_ADDRESS. */
  to: string;
  /** Monto en USDC con 6 decimales (formato raw: "1000000" = 1 USDC). */
  rawAmount: string;
  /** Confirmaciones mínimas; default 1. */
  confirmations?: number;
}

/**
 * Verificación de un pago en USDC. El server llama a esto después de que
 * el cliente manda la tx, para confirmar on-chain que el pago es válido
 * antes de marcar la orden como pagada.
 */
export interface UsdcVerifier {
  /** Devuelve null si la tx no existe / aún no se minó / no es un transfer USDC válido. */
  verifyTransfer(args: { txHash: string; expectedTo: string; expectedAmount: string }): Promise<UsdcTransfer | null>;
}

/**
 * Minter de badges NFT (ERC-721). El server lo llama cuando un usuario
 * registrado desbloquea un badge por primera vez.
 */
export interface BadgeMinter {
  /**
   * Mint a badge NFT. Naming follows the OZ 5.x baseline
   * (`safeMint`) — the legacy name `mintBadge` shadowed the
   * virtual `tokenURI` function and was renamed.
   */
  safeMint(params: MintBadgeParams): Promise<TxResult>;
}

/**
 * Emitter de eventos de review. Se loguea on-chain para tener trazabilidad
 * pública (no requiere que el usuario pague gas — el server puede emitir
 * desde su propia wallet si está configurada; por ahora mock).
 */
export interface ReviewEmitter {
  emitReview(params: EmitReviewParams): Promise<TxResult>;
}

/**
 * Proveedor de wallet del cliente. Wrapper sobre window.ethereum (EIP-1193).
 * Vive solo en el cliente; no se importa en código server-side.
 */
export interface WalletProvider {
  /** Pide al usuario conectar MetaMask/Rabby/etc. Devuelve la address. */
  connect(): Promise<string>;
  /** Devuelve la address actual o null si no hay conexión. */
  getAddress(): Promise<string | null>;
  /** Firma un mensaje (para probar ownership sin gastar gas). */
  signMessage(message: string): Promise<string>;
  /** Envía un transfer de USDC. Devuelve el txHash. */
  sendUsdcTransfer(args: { to: string; rawAmount: string }): Promise<string>;
}