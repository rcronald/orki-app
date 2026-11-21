import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { Page } from '../components/Page.tsx'
import { CatalogAdminView } from './CatalogAdminView.tsx'
import { supabaseCatalogAdminSource } from './source.ts'
import {
  catalogAdminSearchParams,
  parseCatalogAdminState,
  type CatalogAdminState,
} from './url-state.ts'

// Backoffice del catálogo (/administracion/catalogo, #99): conecta la pantalla
// con la URL y con Supabase. Solo para administradores (RequireCatalogAdmin en
// App.tsx; la protección real es la de la base). Va en su propio chunk, que
// App.tsx carga de forma diferida.
//
// Todo el estado (pestaña, búsqueda, filtros, página y detalle) vive en la URL
// (ver url-state.ts): recargar o compartir el enlace muestra lo mismo. Escribir
// en un buscador sustituye la entrada del historial; cambiar de filtro, de
// página, de pestaña o abrir un detalle añade una, para volver con "atrás".

function hrefFor(state: CatalogAdminState): string {
  const search = catalogAdminSearchParams(state).toString()
  return search === '' ? '.' : `?${search}`
}

export default function CatalogAdminPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const state = useMemo(
    () => parseCatalogAdminState(searchParams),
    [searchParams],
  )

  const onStateChange = useCallback(
    (next: CatalogAdminState, options?: { replace?: boolean }) => {
      setSearchParams(catalogAdminSearchParams(next), {
        replace: options?.replace ?? false,
        preventScrollReset: true,
      })
    },
    [setSearchParams],
  )

  return (
    <Page title="Administración del catálogo" width="full">
      <CatalogAdminView
        state={state}
        onStateChange={onStateChange}
        source={supabaseCatalogAdminSource}
        hrefFor={hrefFor}
      />
    </Page>
  )
}
