import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../components/ui/Button.tsx'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.tsx'
import { Modal } from '../components/ui/Modal.tsx'
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
//
// Mientras se guarda (`busy`, #279) no se puede salir por ninguna de las
// cuatro vías: el guardado en curso puede estar creando la fila de una foto
// nueva, y salir a mitad dejaría el guardado partido. Un enlace, «atrás» o
// «Volver a la planta» abren un aviso que solo dice que se espere (sin «Salir
// sin guardar»), y la pestaña pide el aviso nativo. El aviso se cierra solo
// al terminar el guardado: si sale bien, la pantalla vuelve a la ficha; si
// falla, se queda con el error.

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

/**
 * Textos del diálogo de salir, si no son los de la edición: el registro con
 * fotos por subir (#284).
 */
export interface LeaveGuardText {
  title: string
  description: ReactNode
  confirm: string
  stay: string
}

type Pending =
  | { kind: 'confirm'; proceed: () => void; stay: () => void }
  /** Se intentó salir durante el guardado: solo se avisa. */
  | { kind: 'busy' }

/**
 * Protege la edición de salir con cambios sin guardar. `partial`: un intento
 * de guardar ya dejó parte de los cambios en la base (el diálogo lo dice).
 * `busy`: hay un guardado en curso; mientras dure no se puede salir. `text`:
 * otros textos para el diálogo (por defecto, los de la edición).
 */
export function useLeaveGuard({
  dirty,
  partial = false,
  busy = false,
  text,
}: {
  dirty: boolean
  partial?: boolean
  busy?: boolean
  text?: LeaveGuardText
}): LeaveGuard {
  const navigate = useNavigate()
  const [pending, setPending] = useState<Pending | null>(null)
  const armed = useRef(false)
  const leaving = useRef(false)
  const dirtyRef = useRef(dirty)
  const busyRef = useRef(busy)
  useEffect(() => {
    dirtyRef.current = dirty
    busyRef.current = busy
  })
  const guarded = dirty || busy
  const busyDescriptionId = useId()

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
      if (busyRef.current) {
        setPending({ kind: 'busy' })
        return
      }
      setPending({
        kind: 'confirm',
        proceed: () => {
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
      if (!dirtyRef.current && !busyRef.current) {
        void leave(go)
        return
      }
      ask(go)
    },
    [ask, leave],
  )

  // Guarda en el historial mientras haya cambios (o un guardado en curso).
  useEffect(() => {
    if (guarded) arm()
  }, [guarded, arm])

  // «Atrás»: se salió de la guarda.
  useEffect(() => {
    const onPopState = () => {
      if (!armed.current || leaving.current) return
      if (isGuard(window.history.state)) return
      armed.current = false
      if (busyRef.current) {
        // Guardando: se vuelve a poner la guarda y solo se avisa.
        arm()
        setPending({ kind: 'busy' })
        return
      }
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
    if (!guarded) return
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
  }, [guarded, ask, navigate])

  // Cerrar o recargar la pestaña: el aviso nativo.
  useEffect(() => {
    if (!guarded) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (leaving.current) return
      event.preventDefault()
      // Navegadores antiguos: hace falta returnValue.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [guarded])

  // El aviso de esperar se cierra solo al terminar el guardado (y no vuelve a
  // salir en el siguiente).
  const [wasBusy, setWasBusy] = useState(busy)
  if (wasBusy !== busy) {
    setWasBusy(busy)
    if (!busy && pending?.kind === 'busy') setPending(null)
  }
  const close = () => setPending(null)
  const shown = pending?.kind === 'busy' && !busy ? null : pending
  const dialog =
    shown === null ? null : shown.kind === 'busy' ? (
      <Modal
        title={EDIT_LEAVE_TEXT.busyTitle}
        describedBy={busyDescriptionId}
        onCancel={close}
      >
        <p id={busyDescriptionId} className="text-md text-neutral-900">
          {EDIT_LEAVE_TEXT.busyDescription}
        </p>
        <div className="flex justify-end">
          <Button onClick={close}>{EDIT_LEAVE_TEXT.busyOk}</Button>
        </div>
      </Modal>
    ) : (
      <ConfirmDialog
        title={text?.title ?? EDIT_LEAVE_TEXT.title}
        description={
          text?.description ?? (
            <>
              <p>{EDIT_LEAVE_TEXT.description}</p>
              {partial && (
                <p className="mt-space-2">{EDIT_LEAVE_TEXT.partial}</p>
              )}
            </>
          )
        }
        confirmLabel={text?.confirm ?? EDIT_LEAVE_TEXT.confirm}
        cancelLabel={text?.stay ?? EDIT_LEAVE_TEXT.stay}
        initialFocus="cancel"
        onConfirm={shown.proceed}
        onCancel={shown.stay}
      />
    )

  return { requestLeave, leave, dialog }
}
