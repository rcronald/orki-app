/* eslint-disable react-refresh/only-export-components -- sustituto de un paquete, no un módulo de componentes */
import {
  cloneElement,
  isValidElement,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

// Sustituto de @clerk/react en los builds de medición y de pruebas de extremo
// a extremo (sustitutos.ts): Clerk "cargado" sin descargar su script ni hablar
// con su API. Solo simula lo que usa la app (como src/test/clerk-mock.tsx, que
// no sirve aquí porque depende de Vitest).
//
// La sesión se lee de localStorage, clave SESION_SIMULADA, con la forma
// { "usuario": "user_…" | null, "rol": "catalog_admin" | null }:
// - Sin la clave: sesión iniciada como user_medicion, sin rol (lo que mide
//   scripts/medir-carga.mjs).
// - usuario null: sin sesión. <SignIn> y <SignUp> pintan un botón que la
//   inicia como USUARIO_AL_ENTRAR, como si se hubiera completado el acceso.
// - rol: el claim app_role del token (catalog_admin, el del backoffice).
//
// El token que devuelve getToken() lleva el usuario y el rol en claro
// (tokenSimulado), para que el Supabase simulado de las pruebas aplique las
// mismas reglas que las políticas RLS. No es un JWT ni sirve fuera de aquí.
//
// Sin conexión al cargar la página, Clerk queda en "error", como el real
// cuando su script no llega (docs/sin-conexion.md): así la app entra en su
// modo sin conexión igual que en un celular.

export const SESION_SIMULADA = 'orki-sesion-simulada'
export const USUARIO_POR_DEFECTO = 'user_medicion'
export const USUARIO_AL_ENTRAR = 'user_e2e'

interface Sesion {
  usuario: string | null
  rol: string | null
}

function leerSesion(): Sesion {
  try {
    const crudo = localStorage.getItem(SESION_SIMULADA)
    if (crudo === null) return { usuario: USUARIO_POR_DEFECTO, rol: null }
    const valor = JSON.parse(crudo) as Partial<Sesion>
    return {
      usuario: typeof valor.usuario === 'string' ? valor.usuario : null,
      rol: typeof valor.rol === 'string' ? valor.rol : null,
    }
  } catch {
    return { usuario: USUARIO_POR_DEFECTO, rol: null }
  }
}

/** Token con el usuario y el rol, en base64 sin relleno. */
export function tokenSimulado(sesion: Sesion): string {
  const datos = JSON.stringify({ sub: sesion.usuario, app_role: sesion.rol })
  return `simulado.${btoa(datos).replace(/=+$/, '')}`
}

const status =
  typeof navigator !== 'undefined' && navigator.onLine === false
    ? ('error' as const)
    : ('ready' as const)

let sesion = leerSesion()
const oyentes = new Set<() => void>()

function cambiarSesion(siguiente: Sesion) {
  sesion = siguiente
  try {
    localStorage.setItem(SESION_SIMULADA, JSON.stringify(siguiente))
  } catch {
    // Sin almacenamiento: solo en memoria.
  }
  for (const oyente of oyentes) oyente()
}

function suscribir(oyente: () => void) {
  oyentes.add(oyente)
  return () => oyentes.delete(oyente)
}

// La misma función en cada pintado, como la real; sin sesión, null.
function getToken() {
  return Promise.resolve(sesion.usuario === null ? null : tokenSimulado(sesion))
}

// Props de <ClerkProvider> que usa signOut(), como el real.
let navegar: ((destino: string) => unknown) | undefined
let destinoAlSalir = '/'

// Como el real: el cierre pasa por la red de Clerk (aquí, una espera
// mínima), después navega a afterSignOutUrl y al final avisa de que ya no hay
// sesión, para no pintar un momento una ruta protegida sin sesión.
async function signOut() {
  await new Promise((resolver) => setTimeout(resolver, 50))
  await navegar?.(destinoAlSalir)
  cambiarSesion({ usuario: null, rol: null })
}

function entrar() {
  cambiarSesion({ usuario: USUARIO_AL_ENTRAR, rol: null })
}

const CLERK = { status, signOut }

// Una instancia por sesión, para que useAuth() devuelva el mismo objeto
// mientras no cambie (como el real entre pintados).
let estadoCacheado: { de: Sesion; valor: ReturnType<typeof estadoDe> } | null =
  null

function estadoDe(actual: Sesion) {
  if (status !== 'ready') {
    return {
      isLoaded: false,
      isSignedIn: undefined,
      userId: undefined,
      sessionClaims: undefined,
      getToken,
    }
  }
  if (actual.usuario === null) {
    return {
      isLoaded: true,
      isSignedIn: false,
      userId: null,
      sessionClaims: null,
      getToken,
    }
  }
  const sessionClaims: Record<string, unknown> = { sub: actual.usuario }
  if (actual.rol !== null) sessionClaims.app_role = actual.rol
  return {
    isLoaded: true,
    isSignedIn: true,
    userId: actual.usuario,
    sessionClaims,
    getToken,
  }
}

function estadoActual() {
  if (estadoCacheado?.de !== sesion) {
    estadoCacheado = { de: sesion, valor: estadoDe(sesion) }
  }
  return estadoCacheado.valor
}

export function ClerkProvider({
  children,
  routerPush,
  afterSignOutUrl,
}: {
  children: ReactNode
  routerPush?: (destino: string) => unknown
  afterSignOutUrl?: string
}) {
  navegar = routerPush
  destinoAlSalir = afterSignOutUrl ?? '/'
  return children
}

export function useClerk() {
  return CLERK
}

export function useAuth() {
  return useSyncExternalStore(suscribir, estadoActual, estadoActual)
}

export function Show({
  when,
  fallback = null,
  children,
}: {
  when: 'signed-in' | 'signed-out'
  fallback?: ReactNode
  children: ReactNode
}) {
  const { isLoaded, isSignedIn } = useAuth()
  if (!isLoaded) return null
  return (when === 'signed-in') === isSignedIn ? children : fallback
}

function AccesoSimulado({
  titulo,
  accion,
}: {
  titulo: string
  accion: string
}) {
  return (
    <section
      aria-labelledby="acceso-simulado"
      className="orki-card flex w-full flex-col gap-space-3 p-space-4"
    >
      <h1
        id="acceso-simulado"
        className="font-display text-xl font-semibold text-neutral-900"
      >
        {titulo}
      </h1>
      <p className="text-md text-neutral-700">
        Acceso simulado: este build no usa Clerk.
      </p>
      <button
        type="button"
        className="orki-btn orki-btn--primary"
        onClick={entrar}
      >
        {accion}
      </button>
    </section>
  )
}

export function SignIn() {
  return (
    <AccesoSimulado
      titulo="Iniciar sesión"
      accion="Entrar con la cuenta de prueba"
    />
  )
}

export function SignUp() {
  return (
    <AccesoSimulado titulo="Crear cuenta" accion="Crear la cuenta de prueba" />
  )
}

export function UserButton() {
  return (
    <button type="button" className="orki-chip">
      Cuenta
    </button>
  )
}

export function SignOutButton({ children }: { children: ReactNode }) {
  if (!isValidElement<{ onClick?: () => void }>(children)) return null
  return cloneElement(children, {
    onClick: () => {
      void signOut()
    },
  })
}
