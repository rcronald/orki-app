import { PublicShell } from '../components/PublicShell.tsx'
import { HomePage } from './HomePage.tsx'

/**
 * La portada completa: cabecera pública, la página y el pie. La pinta
 * HomeRoute sin sesión y, con la misma estructura, va prerrenderada en el
 * index.html del build (src/prerender/, #204), así las dos son siempre
 * iguales y el cambio de una a otra no mueve nada.
 */
export function PublicHome() {
  return (
    <PublicShell>
      <HomePage />
    </PublicShell>
  )
}
