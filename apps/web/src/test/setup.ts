import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'
import { resetOfflineIdentity } from '../auth/offline-identity.ts'
import { finishVoluntarySignOut } from '../auth/voluntary-sign-out.ts'

// findBy… y waitFor esperan 1 s por defecto. Con la máquina cargada (varias
// tandas de pruebas a la vez), la primera carga de una página diferida lo
// supera y la prueba falla sin que haya nada roto. Con 5 s las que pasan
// tardan lo mismo; solo esperan más las que de verdad fallan.
configure({ asyncUtilTimeout: 5000 })

// jsdom no implementa window.scrollTo: no hace nada y escribe «Not
// implemented: Window's scrollTo()» cada vez. Aquí tampoco hace nada, sin el
// aviso; la prueba que necesite comprobarlo lo espía con vi.spyOn.
if (typeof window !== 'undefined') {
  window.scrollTo = () => {}
}

// Sin globals de Vitest, Testing Library no limpia el DOM por sí sola.
afterEach(() => {
  cleanup()
  // jsdom conserva localStorage entre las pruebas de un archivo: un borrador
  // de registro o una preferencia de una prueba no debe aparecer en la otra.
  // Las pruebas que corren en Node no tienen window.
  if (typeof window !== 'undefined') window.localStorage.clear()
  // Y el último usuario recordado (#18), que se lee de ahí.
  resetOfflineIdentity()
  // Y la salida voluntaria en curso, que vive en memoria: una prueba que
  // cierra sesión y no pinta el inicio de verdad (HomeRoute) la dejaría puesta.
  finishVoluntarySignOut()
})
