import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // Nested too: build output has landed under docs/ before now, and a
    // root-only pattern does not catch it.
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'logs/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      // expect(client.method) is how vitest asserts on a spy. Nothing is
      // being called, so there is no `this` to lose.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // The eslint config itself is plain JS and is not part of the TS project.
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
