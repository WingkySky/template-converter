// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // 逐字保真搬移：原签名中的未用参数（如 analyzeSheet 的 monthHint/yearHint）不得改名
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
  {
    files: ['tests/**/*.ts', 'tests/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
