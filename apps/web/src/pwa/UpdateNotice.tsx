import { useEffect, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router'
import { Icon } from '../components/ui/Icon.tsx'
import { actualizacion, type GestorDeActualizacion } from './actualizacion.ts'
import { esPantallaDeTrabajo } from './pantallas-de-trabajo.ts'
import { vigilarFallosDeCarga } from './recarga-por-version.ts'

let vigilando = false

/**
 * La red de seguridad para los import() fuera del pintado (vite:preloadError;
 * ver recarga-por-version.ts). Va aquí, en el chunk de la app, y no en
 * main.tsx, para no sumar las rutas al JavaScript inicial; un fallo del
 * propio chunk de la app lo recoge el límite de errores.
 */
function vigilarFallosDeCargaUnaVez() {
  if (vigilando) return
  vigilando = true
  vigilarFallosDeCarga(() => esPantallaDeTrabajo(window.location.pathname))
}

// Aviso «Hay una versión nueva» (#278; la lógica, en actualizacion.ts).
//
// - Una franja bajo la barra, en el flujo de la página como el aviso de
//   acceso no disponible (AppShell): no queda fija al desplazar, así que no
//   tapa el foco (e2e/foco-no-tapado.spec.ts).
// - No interrumpe: una región viva cortés (aria-live="polite") que el lector
//   anuncia sin mover el foco. Está siempre montada (vacía) para que el
//   anuncio llegue al aparecer el texto; sin role="status", para no sumar un
//   estado vacío a cada pantalla, que ya tienen los suyos.
// - «Actualizar» recarga con la versión nueva; «Cerrar el aviso» lo oculta
//   hasta la próxima versión y deja el foco en el contenido.
// - No aparece en las pantallas de trabajo (registro, edición, ficha,
//   backoffice, acceso; pantallas-de-trabajo.ts): «Actualizar» recargaría la
//   página con lo escrito a medias. Aparece al salir de ellas.

const UPDATE_NOTICE_TEXT = {
  message: 'Hay una versión nueva de orqui.app.',
  update: 'Actualizar',
  updating: 'Actualizando…',
  close: 'Cerrar el aviso',
} as const

interface UpdateNoticeProps {
  /** Solo para pruebas y la muestra: el gestor de la versión nueva. */
  gestor?: GestorDeActualizacion
}

function useActualizacion(gestor: GestorDeActualizacion) {
  return useSyncExternalStore(gestor.suscribir, gestor.leer, gestor.leer)
}

export function UpdateNotice({ gestor = actualizacion }: UpdateNoticeProps) {
  const { pathname } = useLocation()
  const { estado, cerrado, actualizando } = useActualizacion(gestor)
  const visible =
    estado !== 'al-dia' && !cerrado && !esPantallaDeTrabajo(pathname)

  const cerrar = () => {
    gestor.cerrarAviso()
    document.getElementById('contenido')?.focus()
  }

  return (
    <div
      className={
        visible
          ? 'border-b border-neutral-200 bg-neutral-50 px-space-4 py-space-1'
          : undefined
      }
    >
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-center gap-x-space-3">
        <p
          aria-live="polite"
          aria-atomic="true"
          className="text-sm text-neutral-900"
        >
          {visible ? UPDATE_NOTICE_TEXT.message : null}
        </p>
        {visible && (
          <div className="flex items-center gap-space-1">
            <button
              type="button"
              className="orki-link min-h-[44px] cursor-pointer border-0 bg-transparent px-space-2"
              onClick={() => gestor.actualizar()}
            >
              {actualizando
                ? UPDATE_NOTICE_TEXT.updating
                : UPDATE_NOTICE_TEXT.update}
            </button>
            <button
              type="button"
              aria-label={UPDATE_NOTICE_TEXT.close}
              className="grid h-[44px] w-[44px] cursor-pointer place-items-center rounded-pill border-0 bg-transparent text-neutral-900 hover:bg-neutral-0"
              onClick={cerrar}
            >
              <Icon name="x" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Registra el service worker y le dice al gestor cada cambio de pantalla. Va
 * una sola vez en la app (App.tsx), dentro del enrutador.
 */
export function UpdateWatcher({ gestor = actualizacion }: UpdateNoticeProps) {
  const { pathname } = useLocation()
  useEffect(() => {
    vigilarFallosDeCargaUnaVez()
    gestor.iniciar()
  }, [gestor])
  useEffect(() => {
    gestor.alCambiarDePantalla(pathname)
  }, [gestor, pathname])
  return null
}
