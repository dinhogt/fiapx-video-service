import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'packages/*/dist/**',
      'coverage/**',
      'packages/*/coverage/**',
      'node_modules/**',
      '.yarn/**',
      'docs/**',
      '**/*.cjs',
      'eslint.config.mjs',
      'packages/*/jest.config.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  prettier,
);
