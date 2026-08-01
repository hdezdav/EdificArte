/**
 * Tipos para variables globales inyectadas server-side en <script is:inline>.
 *
 * Astro no genera inferencia automática para variables globales seteadas vía
 * `define:vars` desde el frontmatter, así que las declaramos manualmente acá.
 * Sin esto, `astro check` reporta errores como
 * `Property '__X__' does not exist on type 'Window'`.
 */

export {};

declare global {
  interface Window {
    /** Mapbox GL JS access token. Injected in mapa.astro via define:vars. */
    __TURIMAP_TOKEN__?: string;
    /** Legacy: Address receptora de pagos USDC. Inyectada en src/pages/index.astro. */
    __TURIMAP_PAYMENT_ADDRESS__?: string;
    /** Legacy: Address receptora de donaciones USDC. */
    __TURIMAP_DONATION_ADDRESS__?: string;
    /** Legacy: monuments list for proximity notifications */
    __TURIMAP_MONUMENTS__?: Array<{ id: string; name: string; lat: number; lng: number }>;
  }
}