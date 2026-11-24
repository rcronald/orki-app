import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      // El doble de lo que esperan findBy… y waitFor (asyncUtilTimeout en
      // src/test/setup.ts): un waitFor que no llega falla con el mensaje de su
      // aserción, no con un «Test timed out» que no dice qué faltaba (#295).
      testTimeout: 10_000,
      include: ['src/**/*.test.{ts,tsx}'],
      // tokens.css pasa por el procesado de CSS para que la página de muestra
      // reciba su texto con ?raw; el resto del CSS sigue sin procesarse.
      css: { include: [/\/src\/styles\/tokens\.css/] },
    },
  }),
)
