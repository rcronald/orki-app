import { Link } from 'react-router'
import type { CollectionLoadError } from '../collection/source.ts'
import { Button } from '../components/ui/Button.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { PATHS, signInPathFor } from '../routes/paths.ts'
import type { InventoryView } from './preferences.ts'
import { VIEW_CLASSES } from './view-classes.ts'
import { LOAD_ERROR_TEXT, RELOAD_ERROR_TEXT } from './texts.ts'

// Estados de la pantalla de inventario distintos de la lista: carga, error,
// colección vacía y búsqueda sin resultados.

const SKELETON_CARDS = 6

/**
 * Esqueleto de la lista mientras llega la colección: tarjetas vacías con la
 * forma de las reales en la vista elegida, para que la pantalla no salte al
 * llegar los datos. Es decorativo; el lector de pantalla oye el estado.
 */
export function LoadingList({ view }: { view: InventoryView }) {
  const isRow = view === 'list'
  return (
    <>
      <p role="status" className="sr-only">
        Cargando tu colección…
      </p>
      <ul aria-hidden="true" className={VIEW_CLASSES[view]}>
        {Array.from({ length: SKELETON_CARDS }, (_, index) => (
          <li key={index} className="min-w-[0]">
            <div
              className={`orki-card motion-safe:animate-pulse ${isRow ? 'flex-row' : ''}`}
            >
              <div
                className={
                  isRow
                    ? 'aspect-square w-1/4 flex-none self-start bg-neutral-0'
                    : 'aspect-[4/3] w-full bg-neutral-0'
                }
              />
              <div className="flex flex-1 flex-col gap-space-2 p-space-3">
                <div className="h-space-5 w-3/4 rounded-sm bg-neutral-0" />
                <div className="h-space-4 w-1/2 rounded-sm bg-neutral-0" />
                <div className="h-space-4 w-1/3 rounded-sm bg-neutral-0" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

/** Marcador de los contadores mientras cargan, con su misma altura. */
export function LoadingSummary() {
  return (
    <div
      aria-hidden="true"
      className="h-space-5 w-1/2 max-w-xs rounded-sm bg-neutral-50 motion-safe:animate-pulse"
    />
  )
}

/**
 * No se pudo leer la colección y no hay datos que mostrar: el motivo, en
 * español, y "Reintentar". Con la sesión terminada, además, volver a entrar.
 */
export function LoadErrorPanel({
  error,
  onRetry,
}: {
  error: CollectionLoadError
  onRetry: () => void
}) {
  const text = LOAD_ERROR_TEXT[error.reason]
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-space-3 rounded-lg bg-neutral-50 p-space-5"
    >
      <p className="flex items-center gap-space-2 font-display text-xl text-neutral-900">
        <Icon name="triangle-alert" className="size-[24px] flex-none" />
        {text.title}
      </p>
      <p className="text-md text-neutral-900">{text.text}</p>
      <div className="flex flex-wrap gap-space-3">
        <Button onClick={onRetry}>Reintentar</Button>
        {error.reason === 'session-ended' && (
          <Link
            to={signInPathFor(PATHS.collection)}
            className="orki-btn orki-btn--secondary"
          >
            Iniciar sesión
          </Link>
        )}
      </div>
    </div>
  )
}

/**
 * Falló una recarga pero hay datos en memoria: se siguen mostrando y este
 * aviso dice que pueden no estar al día.
 */
export function ReloadErrorBanner({
  error,
  onRetry,
}: {
  error: CollectionLoadError
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-space-3 rounded-lg bg-neutral-50 p-space-4"
    >
      <p className="flex min-w-[0] flex-1 items-start gap-space-2 text-sm text-neutral-900">
        <Icon
          name="triangle-alert"
          className="mt-[2px] size-[16px] flex-none"
        />
        {RELOAD_ERROR_TEXT[error.reason]}
      </p>
      <Button onClick={onRetry}>Reintentar</Button>
    </div>
  )
}

/**
 * Sin orquídeas activas: invitación a registrar la primera. Si solo hay
 * plantas dadas de baja, lo dice (se verán con el filtro de estado del #15).
 */
export function EmptyCollection({ hasInactive }: { hasInactive: boolean }) {
  return (
    <div className="flex flex-col items-start gap-space-3 rounded-lg bg-neutral-50 p-space-5">
      <Icon name="sprout" className="size-[24px] text-secondary" />
      <h2 className="font-display text-xl text-neutral-900">
        {hasInactive
          ? 'No tienes orquídeas activas'
          : 'Tu colección está vacía'}
      </h2>
      <p className="text-md text-neutral-900">
        {hasInactive
          ? 'Las que perdiste o regalaste no se cuentan aquí. Registra una nueva cuando llegue.'
          : 'Registra tu primera orquídea para empezar tu inventario.'}
      </p>
      <Link
        to={PATHS.newPlant}
        className="orki-btn orki-btn--primary orki-btn--block sm:w-auto"
      >
        <Icon name="plus" />
        {hasInactive ? 'Registrar orquídea' : 'Registrar mi primera orquídea'}
      </Link>
    </div>
  )
}

/** La búsqueda no encontró nada: lo dice y ofrece limpiarla. */
export function NoResults({
  query,
  onClear,
}: {
  query: string
  onClear: () => void
}) {
  return (
    <div className="flex flex-col items-start gap-space-3 rounded-lg bg-neutral-50 p-space-5">
      <p className="text-md text-neutral-900">
        Ninguna orquídea de tu colección coincide con «
        <span className="[overflow-wrap:anywhere]">{query.trim()}</span>».
      </p>
      <Button icon="x" onClick={onClear}>
        Limpiar la búsqueda
      </Button>
    </div>
  )
}
