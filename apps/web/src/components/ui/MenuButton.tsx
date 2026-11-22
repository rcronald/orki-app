import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Link } from 'react-router'
import { Icon, type IconName } from './Icon.tsx'

export type MenuItem =
  | {
      kind: 'link'
      label: string
      icon?: IconName
      /** Ruta interna, con el Link de React Router. */
      to: string
      /** Estado de navegación del enlace (por ejemplo, textPageState()). */
      state?: unknown
    }
  | {
      kind: 'action'
      label: string
      icon?: IconName
      onSelect: () => void
    }
  | { kind: 'separator' }

export interface MenuButtonProps {
  /** Contenido del botón: el avatar y «Tu cuenta». Le da el nombre accesible. */
  children: ReactNode
  /** Opciones, en orden; un separator pinta una línea entre grupos. */
  items: readonly MenuItem[]
  /**
   * Texto fijo encima de las opciones, fuera del menú (no es una opción):
   * por ejemplo, el nombre y el correo de la cuenta.
   */
  header?: ReactNode
  className?: string
}

// Botón con menú del sistema (orki-menu, #206 y #207), según el patrón «menu
// button» de las ARIA APG:
// - El botón lleva aria-haspopup="menu", aria-expanded y aria-controls.
// - Al abrir (clic, Intro, Espacio o flecha abajo) el foco va a la primera
//   opción; con flecha arriba, a la última. Se abre al momento, sin animación.
// - Dentro: flechas arriba y abajo (en bucle), Inicio y Fin. Escape cierra y
//   devuelve el foco al botón. Tab cierra y sigue al siguiente control: no
//   atrapa el foco. Un clic fuera también cierra.
// - Las opciones son role="menuitem" con tabIndex -1 (el foco lo mueven las
//   flechas); elegir una cierra el menú.
export function MenuButton({
  children,
  items,
  header,
  className,
}: MenuButtonProps) {
  const id = useId()
  const buttonId = `${id}-boton`
  const menuId = `${id}-menu`
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  // Qué opción enfocar al abrir: la primera o la última.
  const pendingFocus = useRef<'first' | 'last' | null>(null)

  const menuItems = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    )

  useEffect(() => {
    if (!open) return
    if (pendingFocus.current !== null) {
      const list = menuItems()
      const target =
        pendingFocus.current === 'first' ? list[0] : list[list.length - 1]
      pendingFocus.current = null
      target?.focus()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const openMenu = (focus: 'first' | 'last') => {
    pendingFocus.current = focus
    setOpen(true)
  }

  const close = (returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openMenu(event.key === 'ArrowDown' ? 'first' : 'last')
    }
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const list = menuItems()
    const index = list.indexOf(document.activeElement as HTMLElement)
    let next: number
    switch (event.key) {
      case 'ArrowDown':
        next = (index + 1) % list.length
        break
      case 'ArrowUp':
        next = (index - 1 + list.length) % list.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = list.length - 1
        break
      case 'Escape':
        event.preventDefault()
        close(true)
        return
      case 'Tab':
        setOpen(false)
        return
      default:
        return
    }
    event.preventDefault()
    list[next]?.focus()
  }

  return (
    <div
      ref={rootRef}
      className={['orki-menu', className].filter(Boolean).join(' ')}
      onBlur={(event) => {
        if (open && !rootRef.current?.contains(event.relatedTarget)) {
          setOpen(false)
        }
      }}
    >
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        className="orki-menu__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => (open ? close(false) : openMenu('first'))}
        onKeyDown={onButtonKeyDown}
      >
        {children}
        <Icon name="chevron-down" />
      </button>
      <div className="orki-menu__popup" hidden={!open}>
        {header != null && <div className="orki-menu__header">{header}</div>}
        <ul
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={buttonId}
          className="orki-menu__list"
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) =>
            item.kind === 'separator' ? (
              <li
                // Las opciones no cambian de orden mientras el menú existe.
                key={`separador-${index}`}
                role="separator"
                className="orki-menu__separator"
              />
            ) : (
              <li key={item.label} role="none">
                {item.kind === 'link' ? (
                  <Link
                    to={item.to}
                    state={item.state}
                    role="menuitem"
                    tabIndex={-1}
                    className="orki-menu__item"
                    onClick={() => setOpen(false)}
                  >
                    {item.icon && <Icon name={item.icon} />}
                    {item.label}
                  </Link>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className="orki-menu__item"
                    onClick={() => {
                      close(true)
                      item.onSelect()
                    }}
                  >
                    {item.icon && <Icon name={item.icon} />}
                    {item.label}
                  </button>
                )}
              </li>
            ),
          )}
        </ul>
      </div>
    </div>
  )
}
