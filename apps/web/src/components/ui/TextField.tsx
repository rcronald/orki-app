import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'
import { Icon } from './Icon.tsx'

export type TextFieldProps = Omit<
  ComponentPropsWithRef<'input'>,
  'children'
> & {
  /** Etiqueta visible, siempre arriba; el placeholder no la reemplaza. */
  label: ReactNode
  /** Ayuda opcional bajo el campo. */
  hint?: ReactNode
  /**
   * Mensaje de error (añadido de la app, estilos en bundle-extra.css). Marca el
   * campo con aria-invalid y va con el icono triangle-alert.
   */
  error?: ReactNode
  /** Clase adicional del contenedor orki-field. */
  className?: string
}

// Campo de texto del design system (orki-field). Los atributos nativos (type,
// name, value, placeholder, onChange, ref...) van al input. La ayuda y el
// error quedan enlazados al input con aria-describedby.
export function TextField({
  label,
  hint,
  error,
  className,
  id,
  type = 'text',
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...inputProps
}: TextFieldProps) {
  const generatedId = useId()
  const inputId = id ?? `${generatedId}-input`
  const errorId = `${inputId}-error`
  const hintId = `${inputId}-hint`
  const hasError = error != null && error !== false && error !== ''

  const describedByIds = [
    describedBy,
    hasError && errorId,
    hint != null && hintId,
  ]
    .filter(Boolean)
    .join(' ')

  const classes = ['orki-field', className].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <label className="orki-field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        {...inputProps}
        id={inputId}
        type={type}
        className="orki-field__input"
        aria-invalid={hasError ? true : ariaInvalid}
        aria-describedby={describedByIds || undefined}
      />
      {hasError && (
        <span className="orki-field__error" id={errorId}>
          <Icon name="triangle-alert" />
          {error}
        </span>
      )}
      {hint != null && (
        <span className="orki-field__hint" id={hintId}>
          {hint}
        </span>
      )}
    </div>
  )
}
