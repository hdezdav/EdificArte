/// <reference types="astro/client" />

interface Env {
  // === Cloudflare bindings (managed by wrangler.jsonc) ===
  CACHE: import('@cloudflare/workers-types').KVNamespace;
  SESSION: import('@cloudflare/workers-types').KVNamespace;
  DB: import('@cloudflare/workers-types').D1Database;

  // === Public chain vars (from wrangler.jsonc `vars` block) ===
  // USDC nativo en Polygon mainnet (Circle). Para Amoy testnet reemplazá.
  USDC_CONTRACT_ADDRESS: string;
  // URL del RPC público de Polygon. Fallback si ALCHEMY_KEY no está
  // disponible. En prod conviene ALCHEMY_KEY (más rápido + SLA).
  POLYGON_RPC_URL?: string;
  // Address del contrato EdificARteBadge. Vacía hasta deploy.
  PUBLIC_BADGE_CONTRACT_ADDRESS?: string;
  // Address del contrato EdificARteReviews. Vacía hasta deploy.
  PUBLIC_REVIEW_CONTRACT_ADDRESS?: string;
  // Wallet receptora de pagos USDC (recomendado: multisig).
  EDIFICARTE_PAYMENT_ADDRESS?: string;
  // Wallet receptora de donaciones USDC (free-form). Puede ser la misma
  // que EDIFICARTE_PAYMENT_ADDRESS.
  EDIFICARTE_DONATION_ADDRESS?: string;

  // === Secrets (set via `wrangler secret put` or .dev.vars) ===
  // Admin wallet private key (la que deploya + firma mints/emits).
  // Opcional: sin esto, el factory cae a modo MOCK.
  ADMIN_PRIVATE_KEY?: string;
  // Google Gemini API key (chat AI).
  GEMINI_API_KEY?: string;
  // Alchemy API key para Polygon mainnet RPC. Recomendado: subir como
  // secret en prod (no hardcodear en wrangler.jsonc). Si está, se usa
  // ALCHEMY_KEY; si no, fallback a POLYGON_RPC_URL.
  ALCHEMY_KEY?: string;
}

declare namespace App {
  interface Locals {
    runtime: {
      env: Env;
      cf: IncomingRequestCfProperties;
      caches: CacheStorage;
      ctx: ExecutionContext;
    };
  }
}