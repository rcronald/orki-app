import { useEffect, useSyncExternalStore } from 'react'

// Salida voluntaria en curso: la persona pulsó «Cerrar sesión» y la app va
// al inicio, pero todavía no lo ha pintado.
//
// Hace falta porque React Router navega en una transición (BrowserRouter
// envuelve sus cambios en startTransition): el inicio puede tardar en
// pintarse, sobre todo en un dispositivo lento. Mientras tanto se sigue
// viendo la pantalla protegida de la que se sale, y los avisos de sesión
// (el de la app, markSignedOut, y el de Clerk al terminar signOut) se pintan
// enseguida en ella. La salida pendiente (offline-identity.ts) no basta para
// que RequireAuth sepa que se va al inicio: PendingSignOut la borra en
// cuanto Clerk confirma el cierre, que puede llegar antes que el inicio.
// Sin esta marca, RequireAuth veía «sin sesión» sin salida pendiente, como si
// la sesión hubiera caducado, y mandaba a iniciar sesión para volver a la
// pantalla (/iniciar-sesion?redirect_url=…).
//
// Vive lo justo: se pone al pulsar «Cerrar sesión» (useSignOutHere) y se
// quita cuando el inicio ya está pintado (useVoluntarySignOutArrival, en
// HomeRoute), pase lo que pase con Clerk: la app cierra su sesión sin
// esperarle (markSignedOut) y va al inicio aunque signOut() falle o no
// haya conexión. Si la persona se fuera a otra pantalla pública antes de
// que se pintara el inicio, se quita también al volver a entrar
// (RequireAuth con sesión): no debe impedir que, cuando de verdad caduque
// una sesión, se pida entrar para volver a la pantalla. Solo en memoria: si
// se recarga a mitad, la dirección ya es `/` (la navegación la cambia al
// momento) y no hace falta.

let leaving = false
const listeners = new Set<() => void>()

function set(next: boolean) {
  if (leaving === next) return
  leaving = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function current(): boolean {
  return leaving
}

/** La persona pulsó «Cerrar sesión»: la app va al inicio. */
export function startVoluntarySignOut(): void {
  set(true)
}

/** true mientras se va al inicio tras pulsar «Cerrar sesión». */
export function useVoluntarySignOut(): boolean {
  return useSyncExternalStore(subscribe, current, current)
}

/** La salida voluntaria terminó (se llegó al inicio o se volvió a entrar). */
export function finishVoluntarySignOut(): void {
  set(false)
}

/** El inicio ya está pintado: la salida voluntaria terminó. */
export function useVoluntarySignOutArrival(): void {
  useEffect(() => {
    finishVoluntarySignOut()
  }, [])
}
