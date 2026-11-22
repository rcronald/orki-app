import type { ComponentPropsWithRef } from 'react'
import { Icon, type IconName } from './Icon.tsx'

export type ButtonVariant =
  'primary' | 'strong' | 'secondary' | 'danger' | 'danger-outline'

export type ButtonProps = ComponentPropsWithRef<'button'> & {
  /**
   * primary: la acción principal de la pantalla (una sola por pantalla), en
   * verde (color-secondary-strong) en toda la app desde el #206. strong: alias
   * de primary que conservan las páginas públicas; se ven igual.
   * secondary: todo lo demás. danger: acciones destructivas, como borrar;
   * relleno, para la confirmación final. danger-outline: la misma acción con
   * borde y sin relleno, la que abre esa confirmación (#213).
   */
  variant?: ButtonVariant
  /** Ocupa el ancho del contenedor; para la acción principal en móvil. */
  block?: boolean
  /** Icono del sistema de 20 px antes del texto. */
  icon?: IconName
}

// Botón del design system (orki-btn). El texto es un verbo en infinitivo:
// "Registrar orquídea", "Guardar". Es type="button" salvo que se pida otro.
export function Button({
  variant = 'secondary',
  block = false,
  icon,
  className,
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  const classes = [
    'orki-btn',
    `orki-btn--${variant}`,
    block && 'orki-btn--block',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button {...props} type={type} className={classes}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  )
}
