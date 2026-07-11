/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Custom brand colors based on #3f043a
        brand: {
          50: '#fdf2f8',
          100: '#f9dcea',
          200: '#f0b4d2',
          300: '#e085b3',
          400: '#c45490',
          500: '#3f043a',
          600: '#360332',
          700: '#2d0329',
          800: '#230220',
          900: '#1a0118',
          950: '#10010f',
        },
      },
    },
  },
  plugins: [],
};
