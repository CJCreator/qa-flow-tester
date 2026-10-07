import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const wizardNodeModules = ['fs', 'path', 'os', 'crypto', 'child_process', 'http', 'https', 'net'];

export default [
  {
    // Mirrors .gitignore: build output, local data, tool state, worktree copies.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'public/**',
      'sites/**',
      '.qa-*/**',
      '.tmp-*/**',
      '.benchmark/**',
      '.kilo/**',
      '.playwright-mcp/**',
      '.claude/**',
      '.scratch/**',
      '.review-shots/**',
      '.vscode/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: { globals: globals.node },
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    rules: {
      // 112 uses, mostly specs and parsing of untyped input; warn, do not block.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Underscore-prefixed names are intentionally unused.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // Best-effort cleanup paths intentionally swallow errors.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Escapes in existing regexes; never rewrite them just to satisfy lint.
      'no-useless-escape': 'warn',
      // Redaction and sanitising regexes match control characters on purpose.
      'no-control-regex': 'warn',
    },
  },
  {
    files: ['packages/wizard/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // The wizard runs in the browser: no Node built-ins.
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['node:*'], message: 'The wizard must stay browser-safe: no Node imports.' }],
          paths: wizardNodeModules.map((name) => ({
            name,
            message: 'The wizard must stay browser-safe: no Node imports.',
          })),
        },
      ],
    },
  },
  {
    // Spec files build loose fixtures; typing them as any is fine.
    files: ['**/tests/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
];
