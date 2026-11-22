import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { isAccountDeletedState } from '../account/deletion-status.ts'
import { DELETED_NOTICE } from '../account/texts.ts'
import { useFocusOnNavigation, usePageTitle } from '../routes/navigation.ts'

// Pantalla de inicio provisional. Es pública: se ve con o sin sesión y aunque
// Clerk no cargue (sin conexión).
//
// Tras eliminar la cuenta (#110) se llega aquí con el estado
// { accountDeleted: true } y se muestra la confirmación.
export function HomePage() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  usePageTitle(null)
  useFocusOnNavigation(headingRef)
  const location = useLocation()
  const navigate = useNavigate()
  const [deleted] = useState(() => isAccountDeletedState(location.state))
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!deleted) return
    // La región ya está montada (vacía) cuando llega el texto, un instante
    // después: así el lector de pantalla lo anuncia.
    const timer = setTimeout(() => setNotice(DELETED_NOTICE), 0)
    // Sin el estado en el historial, recargar no repite el aviso.
    void navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: null },
    )
    return () => clearTimeout(timer)
    // Solo al llegar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleted])

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-space-3 text-center">
      {deleted && (
        <div role="status" className="max-w-sm">
          {notice && (
            <p className="rounded-md bg-neutral-50 p-space-3 text-md text-neutral-900">
              {notice}
            </p>
          )}
        </div>
      )}
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-display text-display font-semibold text-neutral-900"
      >
        orqui.apps
      </h1>
      <p className="max-w-sm text-lg text-neutral-700">
        Tu colección de orquídeas, siempre a mano.
      </p>
    </div>
  )
}
