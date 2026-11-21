import {
  useId,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Link } from 'react-router'
import { Button } from '../components/ui/Button.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import type { SpeciesStatus } from '../lib/database.ts'
import { PATHS, signInPathFor } from '../routes/paths.ts'
import { LOAD_ERROR_TITLE, STATUS_LABEL } from './texts.ts'
import type { RemoteFailure } from './useRemoteData.ts'

// Piezas comunes de la pantalla del catálogo: buscador, insignia de estado,
// paginación y estados de error, vacío y sin resultados.

export interface SearchFieldProps {
  label: string
  placeholder: string
  value: string
  onValueChange: (value: string) => void
  /** Ayuda bajo el campo. */
  hint?: ReactNode
}

// Campo de búsqueda con etiqueta visible, lupa y botón para limpiar (también
// con Escape), con las clases del campo y del buscador del sistema, como el
// del inventario.
export function SearchField({
  label,
  placeholder,
  value,
  onValueChange,
  hint,
}: SearchFieldProps) {
  const id = useId()
  const inputId = `${id}-buscar`
  const hintId = `${id}-ayuda`
  const inputRef = useRef<HTMLInputElement>(null)

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && value !== '') {
      event.preventDefault()
      onValueChange('')
    }
  }

  return (
    <div role="search" className="orki-field">
      <label className="orki-field__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="orki-autocomplete__control">
        <Icon name="search" className="orki-autocomplete__icon" />
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="searchbox"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={placeholder}
          className="orki-field__input orki-autocomplete__input pr-[calc(var(--space-3)_*_2_+_20px)]"
          value={value}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onValueChange(event.target.value)
          }
          onKeyDown={onKeyDown}
          aria-describedby={hint ? hintId : undefined}
        />
        {value !== '' && (
          <button
            type="button"
            className="absolute inset-y-[0] right-[0] flex items-center rounded-md px-space-3 text-neutral-700 [&>svg]:size-[20px]"
            aria-label="Limpiar la búsqueda"
            onClick={() => {
              onValueChange('')
              inputRef.current?.focus()
            }}
          >
            <Icon name="x" />
          </button>
        )}
      </div>
      {hint && (
        <span id={hintId} className="orki-field__hint">
          {hint}
        </span>
      )}
    </div>
  )
}

/**
 * Estado de una especie del catálogo, con palabra (e icono si pide atención):
 * el color solo no comunica el estado. Usa las insignias del sistema.
 */
export function SpeciesStatusBadge({ status }: { status: SpeciesStatus }) {
  switch (status) {
    case 'validated':
      return (
        <span className="orki-badge orki-badge--validated">
          <Icon name="circle-check" />
          {STATUS_LABEL.validated}
        </span>
      )
    case 'observed':
      return (
        <span className="orki-badge orki-badge--pending">
          <Icon name="triangle-alert" />
          {STATUS_LABEL.observed}
        </span>
      )
    case 'imported':
      return (
        <span className="orki-badge bg-neutral-50 text-neutral-900">
          {STATUS_LABEL.imported}
        </span>
      )
  }
}

export interface PaginationProps {
  /** Nombre del bloque para el lector de pantalla ("Páginas de especies"). */
  label: string
  page: number
  pageCount: number
  hasPrevious: boolean
  hasNext: boolean
  onFirst: () => void
  onPrevious: () => void
  onNext: () => void
  onLast: () => void
}

// Paginación: primera, anterior, "Página n de m", siguiente y última. Los
// botones que no se pueden usar quedan con aria-disabled y no con disabled,
// para que el foco no se pierda al llegar al principio o al final.
export function Pagination({
  label,
  page,
  pageCount,
  hasPrevious,
  hasNext,
  onFirst,
  onPrevious,
  onNext,
  onLast,
}: PaginationProps) {
  const button = (text: string, enabled: boolean, onClick: () => void) => (
    <Button
      aria-disabled={!enabled}
      onClick={() => {
        if (enabled) onClick()
      }}
    >
      {text}
    </Button>
  )
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-space-2">
      {button('Primera', hasPrevious, onFirst)}
      {button('Anterior', hasPrevious, onPrevious)}
      <p className="px-space-2 text-sm text-neutral-700">
        Página {page} de {Math.max(pageCount, 1)}
      </p>
      {button('Siguiente', hasNext, onNext)}
      {button('Última', hasNext, onLast)}
    </nav>
  )
}

/** No se pudo leer: título y motivo, "Reintentar" y, sin sesión, volver a entrar. */
export function LoadError({
  reason,
  message,
  onRetry,
  compact = false,
}: {
  reason: RemoteFailure
  message: string
  onRetry: () => void
  compact?: boolean
}) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-start gap-space-3 rounded-lg bg-neutral-50 ${compact ? 'p-space-4' : 'p-space-5'}`}
    >
      <p
        className={`flex items-center gap-space-2 text-neutral-900 ${compact ? 'font-semibold' : 'font-display text-xl'}`}
      >
        <Icon
          name="triangle-alert"
          className={`flex-none ${compact ? 'size-[16px]' : 'size-[24px]'}`}
        />
        {LOAD_ERROR_TITLE[reason]}
      </p>
      <p className="text-md text-neutral-900">{message}</p>
      <div className="flex flex-wrap gap-space-3">
        <Button onClick={onRetry}>Reintentar</Button>
        {reason === 'session-ended' && (
          <Link
            to={signInPathFor(PATHS.catalogAdmin)}
            className="orki-btn orki-btn--secondary"
          >
            Iniciar sesión
          </Link>
        )}
      </div>
    </div>
  )
}

/** Panel informativo (vacío, sin resultados, página que ya no existe). */
export function Notice({
  icon = 'search',
  children,
  action,
}: {
  icon?: 'search' | 'sprout'
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-start gap-space-3 rounded-lg bg-neutral-50 p-space-5">
      <Icon name={icon} className="size-[24px] text-secondary" />
      <div className="text-md text-neutral-900">{children}</div>
      {action}
    </div>
  )
}
