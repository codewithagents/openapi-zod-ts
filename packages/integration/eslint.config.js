import tseslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

export default [
  {
    files: [
      'generated/**/*.ts',
      'generated-hooks-extended/**/*.ts',
      'generated-matrix/**/*.ts',
      'generated-matrix-legit/**/*.ts',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      // Unused vars unavoidable — consumers use what they need from generated code
      '@typescript-eslint/no-unused-vars': 'off',
      // res.json() returns `any` — DOM API limitation, not ours
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
]
