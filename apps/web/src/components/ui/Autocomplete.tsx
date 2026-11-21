import {
  useEffect,
  useId,
  useState,
  type ComponentPropsWithRef,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Icon } from './Icon.tsx'

export interface AutocompleteOption {
  /** Identificador estable; sirve para la clave y el id de la opción. */
  id: string
  /** Texto principal: el nombre científico o el texto de la sugerencia. */
  label: string
  /** Texto secundario opcional: un sinónimo o el nombre común. */
  secondary?: string
}

export interface AutocompleteAction {
  /** Texto de la acción, por ejemplo "No la encuentro: guardarla con este nombre". */
  label: string
  onSelect: () => void
}

type NativeInputProps = Omit<
  ComponentPropsWithRef<'input'>,
  | 'value'
  | 'defaultValue'
  | 'onChange'
  | 'onSelect'
  | 'type'
  | 'role'
  | 'list'
  | 'children'
  | 'aria-autocomplete'
  | 'aria-expanded'
  | 'aria-controls'
  | 'aria-activedescendant'
>

export interface AutocompleteProps extends NativeInputProps {
  /** Etiqueta visible del campo. */
  label: string
  /** Texto escrito en el campo (componente controlado). */
  value: string
  /** Se llama con el texto nuevo cada vez que la persona escribe. */
  onValueChange: (value: string) => void
  /** Sugerencias ya filtradas por quien usa el componente. */
  options: readonly AutocompleteOption[]
  /** Se llama al elegir una sugerencia con Enter, clic o toque. */
  onOptionSelect: (option: AutocompleteOption) => void
  /** Hay una búsqueda en curso. */
  loading?: boolean
  /**
   * Cómo se muestra el texto principal de cada sugerencia: como nombre
   * científico (cursiva, font-display) o como texto normal.
   */
  labelStyle?: 'scientific' | 'plain'
  /** Acción final opcional dentro de la lista, elegible como una sugerencia. */
  action?: AutocompleteAction
  /** Ayuda bajo el campo. */
  hint?: ReactNode
  /** Mensaje mientras se busca. */
  loadingText?: string
  /** Mensaje cuando no hay sugerencias para el texto escrito. */
  emptyText?: string
  /** Texto del anuncio con el número de sugerencias. */
  formatResultCount?: (count: number) => string
  /**
   * Mensaje de error de la búsqueda (por ejemplo, sin conexión). Se muestra en
   * la lista en lugar de "sin resultados" y se anuncia; el campo y la acción
   * final siguen funcionando.
   */
  error?: string
  /**
   * Caracteres (sin los espacios de los extremos) a partir de los cuales
   * quien usa el componente busca. Con menos, no se muestra "sin resultados".
   * Por defecto 1: cualquier texto.
   */
  minQueryLength?: number
}

const defaultResultCount = (count: number) =>
  count === 1 ? '1 resultado' : `${count} resultados`

/**
 * Buscador con autocompletado de lista (patrón combobox de WAI-ARIA APG con
 * selección manual). Es controlado y no tiene datos propios: recibe el texto y
 * las sugerencias y avisa del cambio de texto y de la elección. El foco real
 * se queda siempre en el campo; la opción activa se indica con
 * aria-activedescendant.
 */
export function Autocomplete({
  label,
  value,
  onValueChange,
  options,
  onOptionSelect,
  loading = false,
  labelStyle = 'plain',
  action,
  hint,
  loadingText = 'Buscando…',
  emptyText = 'Sin resultados',
  formatResultCount = defaultResultCount,
  error,
  minQueryLength = 1,
  id,
  className,
  onKeyDown,
  onBlur,
  'aria-describedby': ariaDescribedBy,
  ...inputProps
}: AutocompleteProps) {
  const baseId = useId()
  const inputId = id ?? `${baseId}-input`
  const listboxId = `${baseId}-listbox`
  const hintId = `${baseId}-hint`
  const actionId = `${baseId}-action`
  const optionId = (index: number) => `${baseId}-option-${index}`

  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  // La acción final cuenta como un elemento más de la lista.
  const itemCount = options.length + (action ? 1 : 0)
  const active = activeIndex >= 0 && activeIndex < itemCount ? activeIndex : -1
  const activeId =
    active === -1
      ? undefined
      : active < options.length
        ? optionId(active)
        : actionId

  const hasQuery = value.trim().length >= Math.max(1, minQueryLength)
  const showError = !loading && Boolean(error) && hasQuery
  const showEmpty = !loading && !showError && options.length === 0 && hasQuery
  const popupVisible =
    open && (loading || itemCount > 0 || showEmpty || showError)
  const expanded = popupVisible && itemCount > 0

  // Mantiene visible la opción activa dentro de la lista con scroll.
  useEffect(() => {
    if (!activeId) return
    const element = document.getElementById(activeId)
    // jsdom no implementa scrollIntoView.
    if (typeof element?.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest' })
    }
  }, [activeId])

  let announcement = ''
  if (popupVisible) {
    const base = loading
      ? loadingText
      : showError
        ? (error ?? '')
        : options.length > 0
          ? formatResultCount(options.length)
          : showEmpty
            ? emptyText
            : ''
    const sentences = [base, itemCount > 0 ? 'Usa las flechas para elegir' : '']
    announcement = sentences
      .filter(Boolean)
      .map((sentence) => (/[.…!?]$/.test(sentence) ? sentence : `${sentence}.`))
      .join(' ')
  }

  const close = () => {
    setOpen(false)
    setActiveIndex(-1)
  }

  const choose = (index: number) => {
    const option = options[index]
    close()
    if (option) onOptionSelect(option)
    else if (index === options.length && action) action.onSelect()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault()
        if (!popupVisible) {
          setOpen(true)
          // Alt + flecha abajo abre la lista sin mover la opción activa.
          setActiveIndex(event.altKey || itemCount === 0 ? -1 : 0)
          return
        }
        if (itemCount === 0) return
        setActiveIndex(
          active === -1 || active === itemCount - 1 ? 0 : active + 1,
        )
        return
      }
      case 'ArrowUp': {
        event.preventDefault()
        if (!popupVisible) {
          setOpen(true)
          setActiveIndex(itemCount === 0 ? -1 : itemCount - 1)
          return
        }
        if (itemCount === 0) return
        setActiveIndex(active <= 0 ? itemCount - 1 : active - 1)
        return
      }
      case 'Enter': {
        if (popupVisible && active !== -1) {
          event.preventDefault()
          choose(active)
        }
        return
      }
      case 'Escape': {
        if (popupVisible) {
          event.preventDefault()
          close()
        } else if (value !== '') {
          // Con la lista cerrada, Escape borra el texto (APG).
          event.preventDefault()
          onValueChange('')
        }
        return
      }
      case 'Home':
      case 'End':
        // Inicio y Fin mueven el cursor dentro del texto; la opción activa
        // vuelve al campo.
        setActiveIndex(-1)
        return
      default:
        return
    }
  }

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    onBlur?.(event)
    close()
  }

  const describedBy =
    [ariaDescribedBy, hint ? hintId : undefined].filter(Boolean).join(' ') ||
    undefined

  return (
    <div
      className={['orki-field', 'orki-autocomplete', className]
        .filter(Boolean)
        .join(' ')}
    >
      <label className="orki-field__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="orki-autocomplete__control">
        <Icon name="search" className="orki-autocomplete__icon" />
        <input
          {...inputProps}
          id={inputId}
          className="orki-field__input orki-autocomplete__input"
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-activedescendant={popupVisible ? activeId : undefined}
          aria-describedby={describedBy}
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value)
            setOpen(true)
            setActiveIndex(-1)
          }}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
        />
        {/* El mousedown solo evita perder el foco; el teclado va en el campo. */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          className="orki-autocomplete__popup"
          hidden={!popupVisible}
          // Chrome hace enfocable con Tab un contenedor con scroll; la lista
          // no debe ser una parada de Tab: el foco se queda en el campo.
          tabIndex={-1}
          // Evita que el campo pierda el foco al tocar la lista o su barra
          // de desplazamiento.
          onMouseDown={(event) => event.preventDefault()}
        >
          {loading && (
            <p className="orki-autocomplete__message">{loadingText}</p>
          )}
          {showEmpty && (
            <p className="orki-autocomplete__message">{emptyText}</p>
          )}
          {showError && (
            <p className="orki-autocomplete__message flex items-center gap-space-2 font-semibold text-danger">
              <Icon
                name="triangle-alert"
                className="h-space-4 w-space-4 flex-none"
              />
              {error}
            </p>
          )}
          <ul
            id={listboxId}
            role="listbox"
            aria-label={label}
            className="orki-autocomplete__listbox"
            hidden={itemCount === 0}
          >
            {options.map((option, index) => (
              // El teclado se maneja en el campo (aria-activedescendant); aquí
              // solo hace falta el clic o el toque.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <li
                key={option.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                tabIndex={-1}
                className="orki-autocomplete__option"
                onClick={() => choose(index)}
              >
                <span
                  className={
                    labelStyle === 'scientific'
                      ? 'orki-autocomplete__label orki-autocomplete__label--scientific'
                      : 'orki-autocomplete__label'
                  }
                >
                  {option.label}
                </span>
                {option.secondary && (
                  <span className="orki-autocomplete__secondary">
                    {/* Pausa para el lector de pantalla entre los dos textos. */}
                    <span className="sr-only">, </span>
                    {option.secondary}
                  </span>
                )}
              </li>
            ))}
            {action && (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <li
                id={actionId}
                role="option"
                aria-selected={active === options.length}
                tabIndex={-1}
                className="orki-autocomplete__option orki-autocomplete__action"
                onClick={() => choose(options.length)}
              >
                <Icon name="plus" className="orki-autocomplete__action-icon" />
                <span>{action.label}</span>
              </li>
            )}
          </ul>
        </div>
      </div>
      {hint && (
        <span id={hintId} className="orki-field__hint">
          {hint}
        </span>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}
