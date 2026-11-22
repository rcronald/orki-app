import type { ComponentPropsWithRef } from 'react'
import { Icon, type IconName } from './Icon.tsx'

export interface SegmentedOption<Value extends string> {
  value: Value
  /** Nombre de la opción: «Cuadrícula». Visible o solo para el lector. */
  label: string
  icon?: IconName
}

export type SegmentedControlProps<Value extends string> = Omit<
  ComponentPropsWithRef<'div'>,
  'onChange' | 'children' | 'role'
> & {
  /** Nombre del grupo para el lector de pantalla: «Vista». */
  label: string
  options: readonly SegmentedOption<Value>[]
  value: Value
  onValueChange: (value: Value) => void
  /**
   * Solo iconos (los nombres quedan para el lector de pantalla y como
   * tooltip). Cada opción necesita su icono.
   */
  iconOnly?: boolean
}

// Control segmentado del sistema (orki-segmented, #206): dos o tres opciones
// excluyentes en una caja con borde color-secondary; la elegida va rellena en
// color-secondary-strong con el texto claro. Cada opción es un botón de
// alternar (aria-pressed) dentro de un grupo con nombre: el lector anuncia
// «Cuadrícula, botón de alternar, presionado». Objetivos de 44 × 44 px.
export function SegmentedControl<Value extends string>({
  label,
  options,
  value,
  onValueChange,
  iconOnly = false,
  className,
  ...props
}: SegmentedControlProps<Value>) {
  return (
    <div
      {...props}
      role="group"
      aria-label={label}
      className={['orki-segmented', className].filter(Boolean).join(' ')}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="orki-segmented__option"
          aria-pressed={option.value === value}
          title={iconOnly ? option.label : undefined}
          onClick={() => onValueChange(option.value)}
        >
          {option.icon && <Icon name={option.icon} />}
          <span className={iconOnly ? 'sr-only' : undefined}>
            {option.label}
          </span>
        </button>
      ))}
    </div>
  )
}
