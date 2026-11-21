import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Sin globals de Vitest, Testing Library no limpia el DOM por sí sola.
afterEach(() => {
  cleanup()
  // jsdom conserva localStorage entre las pruebas de un archivo: un borrador
  // de registro o una preferencia de una prueba no debe aparecer en la otra.
  // Las pruebas que corren en Node no tienen window.
  if (typeof window !== 'undefined') window.localStorage.clear()
})
