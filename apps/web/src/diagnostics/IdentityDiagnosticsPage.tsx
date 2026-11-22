import { useAuth } from '@clerk/react'
import { useEffect, useState, type ReactNode } from 'react'
import { APP_ROLE_CLAIM } from '../auth/roles.ts'
import { useAuthAvailability } from '../auth/useAuthAvailability.ts'
import { Page } from '../components/Page.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import {
  persistentStorageState,
  type PersistentStorageState,
} from '../lib/persistent-storage.ts'
import {
  getSupabase,
  SESSION_TOKEN_ERROR_TEXT,
  sessionTokenFailure,
} from '../lib/supabase.ts'

// Panel de diagnóstico de la identidad (/diagnostico), solo fuera de
// producción: App.tsx lo carga de forma diferida detrás de la misma
// comparación estática con import.meta.env.VITE_APP_ENV que la muestra, así
// que en un build de producción no existe.
//
// Compara el id de usuario según Clerk con el que ve Postgres, que llama a
// public.requesting_user_id() con el cliente de Supabase de la app: si
// coinciden, el token de Clerk llega a Postgres y Supabase lo valida. Funciona
// con y sin sesión (sin sesión, Postgres devuelve vacío). Nunca muestra el
// token ni lo escribe en la consola.

type PostgresResult =
  { state: 'done'; userId: string | null } | { state: 'error'; message: string }

interface KeyedResult {
  /** Consulta a la que responde; si no es la actual, la actual está en curso. */
  key: string
  result: PostgresResult
}

function describeError(error: unknown): string {
  const failure = sessionTokenFailure(error)
  if (failure !== null) return SESSION_TOKEN_ERROR_TEXT[failure]
  if (typeof error === 'object' && error !== null) {
    const { message, code } = error as { message?: unknown; code?: unknown }
    if (typeof message === 'string' && message !== '') {
      return typeof code === 'string' && code !== ''
        ? `${message} (código ${code})`
        : message
    }
  }
  return 'Error desconocido al consultar Postgres.'
}

async function queryPostgresUserId(): Promise<PostgresResult> {
  try {
    const supabase = await getSupabase()
    const { data, error } = await supabase.rpc('requesting_user_id')
    if (error) return { state: 'error', message: describeError(error) }
    return { state: 'done', userId: data ?? null }
  } catch (error) {
    return { state: 'error', message: describeError(error) }
  }
}

export default function IdentityDiagnosticsPage() {
  const availability = useAuthAvailability()
  const { isLoaded, isSignedIn, userId, sessionClaims } = useAuth()
  const [attempt, setAttempt] = useState(0)
  const [latest, setLatest] = useState<KeyedResult | null>(null)

  // Id según Clerk: undefined si Clerk no ha dado su estado todavía (cargando o
  // no disponible), null sin sesión.
  const clerkUserId: string | null | undefined =
    availability === 'ready' && isLoaded
      ? isSignedIn
        ? (userId ?? null)
        : null
      : undefined

  // Se consulta cuando Clerk ya decidió (o no está disponible: entonces la
  // petición va como anon) y cada vez que cambia la sesión o se pide de nuevo.
  const canQuery = availability !== 'loading'
  const queryKey = `${String(clerkUserId)}|${attempt}`

  useEffect(() => {
    if (!canQuery) return
    let cancelled = false
    void queryPostgresUserId().then((result) => {
      if (!cancelled) setLatest({ key: queryKey, result })
    })
    return () => {
      cancelled = true
    }
  }, [canQuery, queryKey])

  const result = latest?.key === queryKey ? latest.result : null
  const persisted = usePersistentStorageState()
  const rawRole: unknown = sessionClaims?.[APP_ROLE_CLAIM]

  return (
    <Page title="Diagnóstico de identidad">
      <p className="text-neutral-700">
        Compara el usuario que conoce Clerk con el que ve Postgres en las
        peticiones de la app. Solo existe fuera de producción.
      </p>
      <dl className="flex flex-col gap-space-3 rounded-md bg-neutral-50 p-space-4 text-neutral-900">
        <Row term="Usuario según Clerk">
          <ClerkValue availability={availability} userId={clerkUserId} />
        </Row>
        <Row term="Usuario según Postgres">
          <PostgresValue canQuery={canQuery} result={result} />
        </Row>
        <Row term="¿Coinciden?">
          <MatchValue clerkUserId={clerkUserId} result={result} />
        </Row>
        <Row term={`Claim ${APP_ROLE_CLAIM}`}>
          {clerkUserId === undefined
            ? 'Sin datos de Clerk'
            : clerkUserId === null
              ? 'Sin sesión'
              : typeof rawRole === 'string' && rawRole !== ''
                ? rawRole
                : 'Sin rol'}
        </Row>
        <Row term="Almacenamiento persistente">
          {PERSISTENT_STORAGE_TEXT[persisted ?? 'pending']}
        </Row>
      </dl>
      {result?.state === 'error' && (
        <div
          role="alert"
          className="flex flex-col gap-space-1 rounded-md bg-neutral-50 p-space-4 text-neutral-900"
        >
          <p className="font-semibold">No se pudo consultar Postgres</p>
          <p className="break-words">{result.message}</p>
        </div>
      )}
      <Button
        variant="primary"
        disabled={!canQuery || result === null}
        onClick={() => setAttempt((value) => value + 1)}
      >
        Volver a consultar
      </Button>
    </Page>
  )
}

// Si el navegador conserva la copia local y las miniaturas aunque le falte
// espacio (#18, lib/persistent-storage.ts): lo que responde cada plataforma.
const PERSISTENT_STORAGE_TEXT: Record<
  PersistentStorageState | 'pending',
  string
> = {
  pending: 'Consultando…',
  granted: 'Sí, concedido',
  denied: 'No (el navegador puede borrarlo si le falta espacio)',
  unsupported: 'El navegador no lo permite',
}

function usePersistentStorageState(): PersistentStorageState | null {
  const [state, setState] = useState<PersistentStorageState | null>(null)
  useEffect(() => {
    let cancelled = false
    void persistentStorageState().then((value) => {
      if (!cancelled) setState(value)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return state
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-space-1">
      <dt className="text-sm font-semibold text-secondary">{term}</dt>
      <dd className="break-all">{children}</dd>
    </div>
  )
}

function ClerkValue({
  availability,
  userId,
}: {
  availability: ReturnType<typeof useAuthAvailability>
  userId: string | null | undefined
}) {
  if (availability === 'offline') return 'No disponible: sin conexión'
  if (availability === 'failed') return 'No disponible: Clerk no cargó'
  if (userId === undefined) return 'Cargando…'
  return userId ?? 'Sin sesión'
}

function PostgresValue({
  canQuery,
  result,
}: {
  canQuery: boolean
  result: PostgresResult | null
}) {
  if (!canQuery) return 'Esperando a Clerk…'
  if (result === null) return <span role="status">Consultando…</span>
  if (result.state === 'error') return 'Error (ver el aviso)'
  return result.userId ?? 'Vacío (sin sesión)'
}

function MatchValue({
  clerkUserId,
  result,
}: {
  clerkUserId: string | null | undefined
  result: PostgresResult | null
}) {
  if (clerkUserId === undefined || result?.state !== 'done') {
    return 'No se puede comparar todavía'
  }
  if (clerkUserId === result.userId) {
    return (
      <span className="inline-flex items-center gap-space-1">
        <Icon name="circle-check" className="size-5 text-success" />
        {clerkUserId === null ? 'Sí, los dos sin sesión' : 'Sí'}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-space-1 font-semibold text-danger">
      <Icon name="triangle-alert" className="size-5" />
      No
    </span>
  )
}
