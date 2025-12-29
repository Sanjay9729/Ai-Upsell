import remixConfig from '@remix-run/eslint-config';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'node_modules/**',
      '.build/**',
      'dist/**',
      'public/**',
    ],
  },
  ...remixConfig,
  prettierConfig,
];
