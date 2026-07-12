import eslintPluginAstro from 'eslint-plugin-astro';
import tsEslint from 'typescript-eslint';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/',
      '.astro/',
      'node_modules/',
      'worker-configuration.d.ts',
      'tempmediaStorage/',
      // Hardhat/contracts config usan `require` por convención de la toolchain.
      // No vale la pena (ni es seguro) aplicar reglas TS-ESLint a configs
      // CJS de tooling externo.
      'hardhat.config.cjs',
      'contracts/',
    ],
  },
  ...tsEslint.configs.recommended,
  ...eslintPluginAstro.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Add custom strict rules if needed
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
];
