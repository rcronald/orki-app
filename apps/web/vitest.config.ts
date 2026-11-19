import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // tokens.css pasa por el procesado de CSS para que la página de muestra
      // reciba su texto con ?raw; el resto del CSS sigue sin procesarse.
      css: { include: [/\/src\/styles\/tokens\.css/] },
    },
  }),
)
