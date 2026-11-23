import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.tsx'
import { EDIT_LEAVE_TEXT } from './texts.ts'

// Aviso de cambios sin guardar (#266) al salir de la edición por las cuatro
// vías: un enlace de la app, «atrás» del navegador, «Cancelar» (o «Volver a
// la ficha») y cerrar o recargar la pestaña.
//
// La app usa <BrowserRouter> (modo declarativo), donde useBlocker de React
// Router no existe (exige un enrutador de datos). Por eso:
//
// - Enlaces: un oyente de clic en document, en fase de captura, ve el clic
//   antes que el Link de React Router. Si es un enlace interno normal (botón
//   principal, sin teclas de modificación, mismo origen, sin target ni
//   download), lo detiene y abre el diálogo; al confirmar, navega a su
//   destino. Los enlaces con data-sin-aviso los gestiona la pantalla (el de
//   volver, que hace lo mismo que «Cancelar»).
// - «Atrás»: con cambios, se apila una entrada de guarda en el historial con
//   la misma dirección y el mismo estado (React Router no la distingue). Al
//   pulsar «atrás» se sale de la guarda a la entrada de la edición, sin
//   cambiar de pantalla, y se abre el diálogo. «Seguir editando» vuelve a
//   poner la guarda; «Salir sin guardar» da otro paso atrás, el de verdad.
//   Antes de salir a propósito (guardar, cancelar, un enlace), la guarda se
//   quita primero (disarm) para no dejar una entrada repetida en el
//   historial.
// - Pestaña: beforeunload con el aviso nativo del navegador (el único que
//   puede salir ahí; su texto no se puede cambiar).
//
// El diálogo es el del proyecto (ConfirmDialog sobre Modal): foco dentro,
// «Seguir editando» primero (la acción segura), Escape cierra y el foco
// vuelve a donde estaba. Sin cambios no pregunta.

const GUARD = 'orkiEditGuard'

function isGuard(state: unknown): boolean {
  return typeof state === 'object' && state !== null && GUARD in state
}

/** Si un clic en un enlace es una navegación interna normal de la app. */
function internalTarget(event: MouseEvent): string | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return null
  }
  const target = event.target
  if (!(target instanceof Element)) return null
  const anchor = target.closest('a[href]')
  if (!(anchor instanceof HTMLAnchorElement)) return null
  if (anchor.closest('[data-sin-aviso]')) return null
  if (anchor.target !== '' && anchor.target !== '_self') return null
  if (anchor.hasAttribute('download')) return null
  const url = new URL(anchor.href, window.location.href)
  if (url.origin !== window.location.origin) return null
  return `${url.pathname}${url.search}${url.hash}`
}

export interface LeaveGuard {
  /**
   * Salir a propósito: pregunta si hay cambios y, si se confirma (o no hay
   * cambios), quita la guarda y llama a `go`.
   */
  requestLeave: (go: () => void) => void
  /** Salir sin preguntar (tras guardar): quita la guarda y llama a `go`. */
  leave: (go: () => void) => Promise<void>
  /** El diálogo, para pintarlo en la pantalla (null si está cerrado). */
  dialog: ReactNode
}

interface Pending {
  proceed: () => void
  stay: () => void
}

/**
 * Protege la edición de salir con cambios sin guardar. `partial`: un intento
 * de guardar ya dejó parte de los cambios en la base (el diálogo lo dice).
 * `onLeave` se llama al salir sin guardar (para borrar lo subido sin fila).
 */
export function useLeaveGuard({
  dirty,
  partial = false,
  onDiscard,
}: {
  dirty: boolean
  partial?: boolean
  onDiscard?: () => void
}): LeaveGuard {
  const navigate = useNavigate()
  const [pending, setPending] = useState<Pending | null>(null)
  const armed = useRef(false)
  const leaving = useRef(false)
  const dirtyRef = useRef(dirty)
  const discardRef = useRef(onDiscard)
  useEffect(() => {
    dirtyRef.current = dirty
    discardRef.current = onDiscard
  })

  const arm = useCallback(() => {
    if (armed.current || leaving.current) return
    window.history.pushState(
      { ...(window.history.state as object | null), [GUARD]: true },
      '',
      window.location.href,
    )
    armed.current = true
  }, [])

  /** Quita la guarda del historial (si está encima) y espera a que se vaya. */
  const disarm = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (!armed.current || !isGuard(window.history.state)) {
          armed.current = false
          resolve()
          return
        }
        const done = () => {
          window.removeEventListener('popstate', done)
          armed.current = false
          resolve()
        }
        window.addEventListener('popstate', done)
        window.history.back()
      }),
    [],
  )

  const leave = useCallback(
    async (go: () => void) => {
      leaving.current = true
      setPending(null)
      await disarm()
      go()
    },
    [disarm],
  )

  const ask = useCallback(
    (go: () => void, stay: () => void = () => undefined) => {
      setPending({
        proceed: () => {
          discardRef.current?.()
          void leave(go)
        },
        stay: () => {
          setPending(null)
          stay()
        },
      })
    },
    [leave],
  )

  const requestLeave = useCallback(
    (go: () => void) => {
      if (leaving.current) return
      if (!dirtyRef.current) {
        void leave(go)
        return
      }
      ask(go)
    },
    [ask, leave],
  )

  // Guarda en el historial mientras haya cambios.
  useEffect(() => {
    if (dirty) arm()
  }, [dirty, arm])

  // «Atrás»: se salió de la guarda.
  useEffect(() => {
    const onPopState = () => {
      if (!armed.current || leaving.current) return
      if (isGuard(window.history.state)) return
      armed.current = false
      if (!dirtyRef.current) {
        // Ya no hay cambios: «atrás» sigue su camino.
        leaving.current = true
        window.history.back()
        return
      }
      ask(
        () => window.history.back(),
        () => arm(),
      )
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [ask, arm])

  // Enlaces de la app.
  useEffect(() => {
    if (!dirty) return
    const onClick = (event: MouseEvent) => {
      if (leaving.current) return
      const to = internalTarget(event)
      if (to === null) return
      event.preventDefault()
      event.stopPropagation()
      ask(() => void navigate(to))
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [dirty, ask, navigate])

  // Cerrar o recargar la pestaña: el aviso nativo.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (leaving.current) return
      event.preventDefault()
      // Navegadores antiguos: hace falta returnValue.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const dialog = pending && (
    <ConfirmDialog
      title={EDIT_LEAVE_TEXT.title}
      description={
        <>
          <p>{EDIT_LEAVE_TEXT.description}</p>
          {partial && <p className="mt-space-2">{EDIT_LEAVE_TEXT.partial}</p>}
        </>
      }
      confirmLabel={EDIT_LEAVE_TEXT.confirm}
      cancelLabel={EDIT_LEAVE_TEXT.stay}
      initialFocus="cancel"
      onConfirm={pending.proceed}
      onCancel={pending.stay}
    />
  )

  return { requestLeave, leave, dialog }
}
