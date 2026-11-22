// @ts-check
import js from '@eslint/js'
import prettier from 'eslint-config-prettier/flat'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores([
    '**/dist',
    '**/dist-medicion',
    '**/test-results',
    '**/playwright-report',
    '**/blob-report',
    '**/coverage',
    '**/node_modules',
  ]),
  // Generado por `npm run db:types` (supabase gen types): no se edita a mano, así que no se
  // le aplican las reglas del proyecto. Sí pasa por Prettier, porque el generador lo formatea.
  globalIgnores(['apps/web/src/lib/database.types.ts']),
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Pruebas de extremo a extremo (#148): corren en Node con Playwright, no son
  // React. Sus fixtures reciben una función `use` que no es el hook de React.
  {
    files: ['apps/web/e2e/**/*.ts', 'apps/web/playwright.config.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
  // Va al final para desactivar las reglas de estilo que chocan con Prettier.
  prettier,
])
