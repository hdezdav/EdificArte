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
    __EDIFICARTE_TOKEN__?: string;
    __TURIMAP_TOKEN__?: string;
    /** Address receptora de pagos USDC. */
    __EDIFICARTE_PAYMENT_ADDRESS__?: string;
    __TURIMAP_PAYMENT_ADDRESS__?: string;
    /** Address receptora de donaciones USDC. */
    __EDIFICARTE_DONATION_ADDRESS__?: string;
    __TURIMAP_DONATION_ADDRESS__?: string;
    /** Monuments list for proximity notifications */
    __EDIFICARTE_MONUMENTS__?: Array<{ id: string; name: string; lat: number; lng: number }>;
    __TURIMAP_MONUMENTS__?: Array<{ id: string; name: string; lat: number; lng: number }>;
    __EDIFICARTE_I18N__?: { es: Record<string, unknown>; en: Record<string, unknown> };
    __TURIMAP_I18N__?: { es: Record<string, unknown>; en: Record<string, unknown> };
    __EDIFICARTE_TOURS__?: Array<unknown>;
    __TURIMAP_TOURS__?: Array<unknown>;
    __EDIFICARTE_EXPERIENCES__?: Record<string, { title: string; image: string; category: string }>;
    __TURIMAP_EXPERIENCES__?: Record<string, { title: string; image: string; category: string }>;
    __EDIFICARTE_GET_VISIBLE_PINS__?: () => Array<{ id: string; name: string; category?: string; lat: number; lng: number; address?: string }>;
  }
}