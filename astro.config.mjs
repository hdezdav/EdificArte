import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    // Compila imágenes con sharp en build time. Cloudflare Workers no soporta
    // sharp en runtime, así que sin esto el adapter emite warning y rompe la
    // optimización de <Image /> cuando se agregue.
    imageService: 'compile',
  }),
  integrations: [tailwind()],
});
