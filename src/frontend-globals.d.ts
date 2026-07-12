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
    /** Address receptora de pagos USDC. Inyectada en src/pages/index.astro. */
    __EDIFICARTE_PAYMENT_ADDRESS__?: string;
    /** Address receptora de donaciones USDC. Inyectada en src/pages/index.astro. */
    __EDIFICARTE_DONATION_ADDRESS__?: string;
    /** Flag anti-race-condition seteado por mapa.astro cuando el usuario pide GPS
     *  desde el modal de bienvenida antes de que mapa-app monte el listener. */
    __edificarteGpsPending?: boolean;
  }
}