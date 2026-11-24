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
    // Copias de trabajo de los agentes (git worktrees): son el repositorio
    // entero otra vez y recorrerlas agota la memoria.
    '.claude/',
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
  // Pruebas unitarias (#295): responder a un doble de la colección sin esperar
  // antes a la petición (`source.last().resolve(...)` tras contar microtareas)
  // se rompe con añadir un solo await en la app. Se espera con
  // `await source.respond(...)` (src/test/collection-source.ts).
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name=/^(resolve|reject)$/][callee.object.type='CallExpression'][callee.object.callee.property.name='last']",
          message:
            'Espera a la petición antes de responderla: await source.respond(...) o source.fail(...), o (await source.pending()).resolve(...), en vez de source.last().resolve(...) (src/test/collection-source.ts).',
        },
      ],
    },
  },
  // Cliente ligero de Supabase (#286): la app usa postgrest-js y storage-js a
  // través de src/lib/supabase-client.ts. supabase-js sigue instalado en la
  // raíz para los scripts de Node, así que una importación desde la app
  // resolvería y volvería a meter Auth y Realtime en el bundle.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@supabase/supabase-js', '@supabase/supabase-js/*'],
              message:
                'La app no usa supabase-js: pide el cliente con getSupabase() o getPublicSupabase() (src/lib/supabase.ts).',
            },
          ],
        },
      ],
    },
  },
  // Va al final para desactivar las reglas de estilo que chocan con Prettier.
  prettier,
])
