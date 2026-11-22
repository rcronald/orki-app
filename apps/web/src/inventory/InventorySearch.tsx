import {
  useId,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { Icon } from '../components/ui/Icon.tsx'

export interface InventorySearchProps {
  /** Texto buscado (componente controlado). */
  value: string
  /** Se llama con el texto nuevo en cada pulsación. */
  onValueChange: (value: string) => void
  /** Texto bajo el campo: cuántas coinciden. Se anuncia sin mover el foco. */
  status?: ReactNode
  /** Referencia al campo, para devolverle el foco desde fuera. */
  inputRef?: RefObject<HTMLInputElement | null>
}

// Buscador del inventario: campo con etiqueta visible, icono de lupa y botón
// para limpiar (también con Escape). Reutiliza las clases del campo y del
// buscador del sistema (orki-field, orki-autocomplete__icon). No filtra nada:
// avisa del texto y quien lo usa decide qué mostrar.
//
// La región de estado (role="status", educada) se monta siempre, vacía si no
// hay nada que decir, para que el lector de pantalla anuncie cada cambio sin
// que el foco salga del campo.
export function InventorySearch({
  value,
  onValueChange,
  status,
  inputRef: externalRef,
}: InventorySearchProps) {
  const id = useId()
  const inputId = `${id}-buscar`
  const statusId = `${id}-estado`
  const ownRef = useRef<HTMLInputElement>(null)
  const inputRef = externalRef ?? ownRef

  const clear = () => {
    onValueChange('')
    inputRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && value !== '') {
      event.preventDefault()
      onValueChange('')
    }
  }

  return (
    <div role="search" className="flex flex-col gap-space-2">
      <div className="orki-field">
        <label className="orki-field__label" htmlFor={inputId}>
          Buscar en tu colección
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
            placeholder="Nombre, género, apodo u origen"
            className="orki-field__input orki-autocomplete__input pr-[calc(var(--space-3)_*_2_+_20px)]"
            value={value}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onValueChange(event.target.value)
            }
            onKeyDown={onKeyDown}
            aria-describedby={statusId}
          />
          {value !== '' && (
            // 44 px de ancho (icono de 20 y space-3 a cada lado) y el alto
            // del campo.
            <button
              type="button"
              className="absolute inset-y-[0] right-[0] flex items-center rounded-md px-space-3 text-neutral-700 [&>svg]:size-[20px]"
              aria-label="Limpiar la búsqueda"
              onClick={clear}
            >
              <Icon name="x" />
            </button>
          )}
        </div>
      </div>
      <p id={statusId} role="status" className="text-sm text-neutral-700">
        {status}
      </p>
    </div>
  )
}
