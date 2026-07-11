/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Custom, premium colors
        brand: {
          50: '#f5f7fa',
          100: '#e4ebf2',
          200: '#c2d4e3',
          300: '#91b2cd',
          400: '#5a8cb3',
          500: '#3c6e94',
          600: '#2f5777',
          700: '#274762',
          800: '#233d52',
          900: '#203445',
          950: '#15222e',
        },
      },
    },
  },
  plugins: [],
};
