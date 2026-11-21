import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { useCollection } from '../collection/useCollection.ts'
import { Page } from '../components/Page.tsx'
import { InventoryView } from '../inventory/InventoryView.tsx'
import { readRegisteredPlant } from '../inventory/registered-plant.ts'
import { RegisteredNotice } from '../inventory/RegisteredNotice.tsx'
import { useScrollMemory } from '../inventory/scroll-memory.ts'

/** Parámetro de la URL con el texto del buscador: /coleccion?q=phal. */
const SEARCH_PARAM = 'q'

// Inventario de la colección del usuario (#14): conecta la pantalla con la
// colección compartida (useCollection). Exige sesión.
//
// El texto buscado vive en la URL (?q=): se conserva al volver con "atrás"
// desde el registro o el detalle, al recargar y al compartir el enlace, sin
// estado propio que sincronizar. Cada pulsación sustituye la entrada del
// historial en lugar de añadir una. Los filtros del #15 irán igual. La
// posición de desplazamiento la guarda useScrollMemory.
//
// Al volver del registro (#85), el estado de la navegación trae la planta
// recién registrada: se muestra un aviso de confirmación y se borra ese
// estado del historial, para que recargar o volver con "atrás" no lo repita.
export function CollectionPage() {
  const { status, plants, error, reload } = useCollection()
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get(SEARCH_PARAM) ?? ''
  const location = useLocation()
  const navigate = useNavigate()
  const [registered, setRegistered] = useState(() =>
    readRegisteredPlant(location.state),
  )
  const hasRegisteredState = readRegisteredPlant(location.state) !== null

  useEffect(() => {
    if (!hasRegisteredState) return
    void navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: null, preventScrollReset: true },
    )
  }, [hasRegisteredState, location.pathname, location.search, navigate])

  const setQuery = useCallback(
    (value: string) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (value === '') next.delete(SEARCH_PARAM)
          else next.set(SEARCH_PARAM, value)
          return next
        },
        { replace: true, preventScrollReset: true },
      )
    },
    [setSearchParams],
  )

  useScrollMemory(plants !== null)

  return (
    <Page title="Mi colección" width="wide">
      {registered && (
        <RegisteredNotice
          key={registered.id}
          plant={registered}
          onDismiss={() => setRegistered(null)}
        />
      )}
      <InventoryView
        status={status}
        plants={plants}
        error={error}
        onRetry={reload}
        query={query}
        onQueryChange={setQuery}
      />
    </Page>
  )
}
