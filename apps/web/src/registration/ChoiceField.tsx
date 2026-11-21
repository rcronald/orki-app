import { useId, type ReactNode, type Ref } from 'react'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import { Icon } from '../components/ui/Icon.tsx'

// Campo de elección con chips (género y tipo): etiqueta visible que nombra el
// grupo, los chips, la explicación de por qué está bloqueado y el error. El
// grupo y cada chip quedan descritos por la explicación y el error, así el
// lector de pantalla los lee al llegar a cualquiera de los chips.

/**
 * Clases de los chips del formulario: 44 px de alto (el chip del sistema mide
 * 36) y aspecto apagado si están desactivados (sin conexión) o bloqueados.
 */
export const FORM_CHIP_CLASSES =
  'py-space-3 disabled:cursor-not-allowed disabled:text-neutral-700 disabled:hover:bg-neutral-50'

/** Clases extra de un chip no elegido de un grupo bloqueado. */
export const LOCKED_CHIP_CLASSES =
  'cursor-not-allowed text-neutral-700 hover:bg-neutral-50'

export interface ChoiceFieldProps {
  label: string
  /** Explicación de por qué no se puede cambiar; solo si está bloqueado. */
  lockedHint?: string
  error?: string
  containerRef?: Ref<HTMLDivElement>
  /** Recibe los ids que describen cada chip (explicación y error). */
  children: (describedBy: string | undefined) => ReactNode
  /** Lo que va bajo los chips, antes de la explicación y el error. */
  after?: ReactNode
}

export function ChoiceField({
  label,
  lockedHint,
  error,
  containerRef,
  children,
  after,
}: ChoiceFieldProps) {
  const baseId = useId()
  const labelId = `${baseId}-label`
  const hintId = `${baseId}-hint`
  const errorId = `${baseId}-error`
  const describedBy =
    [lockedHint && hintId, error && errorId].filter(Boolean).join(' ') ||
    undefined

  return (
    <div ref={containerRef} className="flex flex-col gap-space-2">
      <p id={labelId} className="orki-field__label">
        {label}
      </p>
      <ChipGroup aria-labelledby={labelId} aria-describedby={describedBy}>
        {children(describedBy)}
      </ChipGroup>
      {after}
      {lockedHint && (
        <span id={hintId} className="orki-field__hint">
          {lockedHint}
        </span>
      )}
      {error && (
        <span id={errorId} className="orki-field__error">
          <Icon name="triangle-alert" />
          {error}
        </span>
      )}
    </div>
  )
}
