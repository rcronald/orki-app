import {
  useId,
  useRef,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { Icon } from './Icon.tsx'

export type SearchFieldProps = Omit<
  ComponentPropsWithRef<'input'>,
  'value' | 'onChange' | 'type' | 'children' | 'ref'
> & {
  /** Nombre del campo: «Buscar en mi colección». */
  label: string
  /**
   * Etiqueta solo para el lector de pantalla (por ejemplo, en escritorio,
   * donde la maqueta deja solo el placeholder). Por defecto, visible.
   */
  hideLabel?: boolean
  /** Texto buscado (componente controlado). */
  value: string
  /** Se llama con el texto nuevo en cada pulsación, al borrar y con Escape. */
  onValueChange: (value: string) => void
  /** Nombre accesible del botón de borrar. */
  clearLabel?: string
  /** Referencia al campo, para darle o devolverle el foco desde fuera. */
  inputRef?: RefObject<HTMLInputElement | null>
  /** Clase adicional del contenedor orki-field. */
  className?: string
}

// Campo de búsqueda del sistema (orki-search, #206): lupa a la izquierda y,
// con texto, un botón para borrarlo (x, 44 × 44 px) que devuelve el foco al
// campo; Escape también lo borra. Es un searchbox de texto (no type="search",
// cuyo aspa nativa cambia según el navegador). No filtra nada: avisa del texto
// y quien lo usa decide qué mostrar. Para anunciar cuántas coinciden, una
// región role="status" fuera, enlazada con aria-describedby.
export function SearchField({
  label,
  hideLabel = false,
  value,
  onValueChange,
  clearLabel = 'Borrar la búsqueda',
  inputRef: externalRef,
  className,
  id,
  onKeyDown,
  ...inputProps
}: SearchFieldProps) {
  const generatedId = useId()
  const inputId = id ?? `${generatedId}-buscar`
  const ownRef = useRef<HTMLInputElement>(null)
  const inputRef = externalRef ?? ownRef

  const clear = () => {
    onValueChange('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.key === 'Escape' && value !== '') {
      event.preventDefault()
      onValueChange('')
    }
  }

  return (
    <div className={['orki-field', className].filter(Boolean).join(' ')}>
      <label
        className={hideLabel ? 'sr-only' : 'orki-field__label'}
        htmlFor={inputId}
      >
        {label}
      </label>
      <div className="orki-search">
        <Icon name="search" className="orki-search__icon" />
        <input
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          inputMode="search"
          {...inputProps}
          ref={inputRef}
          id={inputId}
          type="text"
          role="searchbox"
          className="orki-field__input orki-search__input"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {value !== '' && (
          <button
            type="button"
            className="orki-search__clear"
            aria-label={clearLabel}
            onClick={clear}
          >
            <Icon name="x" />
          </button>
        )}
      </div>
    </div>
  )
}
