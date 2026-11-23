import { PATHS } from './paths.ts'

// De dónde se llegó a una página de texto (privacidad y créditos, #202), para
// su enlace de volver. Va en el estado de navegación del enrutador (el
// `state` de los enlaces), no en document.referrer: así no depende del
// navegador y sobrevive a recargar la página. Sin estado (la dirección abierta
// directamente, o un enlace sin origen), «Volver al inicio».
//
// Para enlazar desde una pantalla nueva: <Link to={PATHS.privacy}
// state={textPageState('cuenta')}>, o privacyLinkProps('cuenta'). Un origen
// nuevo se añade a ORIGINS con su enlace de volver.

const ORIGINS = {
  inicio: { to: PATHS.home, label: 'Volver al inicio' },
  registro: { to: PATHS.signUp, label: 'Volver al registro' },
  coleccion: { to: PATHS.collection, label: 'Volver a Mi colección' },
  cuenta: { to: PATHS.account, label: 'Volver a Tu cuenta' },
  catalogo: { to: PATHS.catalog, label: 'Volver al catálogo' },
} as const

export type TextPageOrigin = keyof typeof ORIGINS

export interface TextPageState {
  origen: TextPageOrigin
}

/** Estado de navegación para un enlace a una página de texto desde `origin`. */
export function textPageState(origin: TextPageOrigin): TextPageState {
  return { origen: origin }
}

/** Props de un enlace a la privacidad desde `origin`: <Link {...props}>. */
export function privacyLinkProps(origin: TextPageOrigin): {
  to: string
  state: TextPageState
} {
  return { to: PATHS.privacy, state: textPageState(origin) }
}

function isOrigin(value: unknown): value is TextPageOrigin {
  return typeof value === 'string' && Object.hasOwn(ORIGINS, value)
}

/** El origen guardado en el estado de navegación; null si no hay. */
export function textPageOrigin(state: unknown): TextPageOrigin | null {
  if (typeof state !== 'object' || state === null || !('origen' in state)) {
    return null
  }
  return isOrigin(state.origen) ? state.origen : null
}

/** Enlace de volver según el estado de navegación; por defecto, al inicio. */
export function textPageBack(state: unknown): { to: string; label: string } {
  return ORIGINS[textPageOrigin(state) ?? 'inicio']
}
