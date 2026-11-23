import type { ComponentPropsWithRef, ReactNode } from 'react'
import { Icon, type IconName } from './Icon.tsx'

/**
 * Tono del resultado:
 * - yes: «Sí, la tienes». Fondo color-secondary-soft e icono relleno.
 * - similar: «Tienes parecidas». Mismo fondo, icono con borde.
 * - no: «Aún no la tienes». Neutro (color-neutral-50), nunca rojo.
 * - notice: un aviso que no es una respuesta («Sin copia disponible»):
 *   neutro, con el icono sobre color-warning.
 */
export type QueryAnswerTone = 'yes' | 'similar' | 'no' | 'notice'

const DEFAULT_ICON: Record<QueryAnswerTone, IconName> = {
  yes: 'check',
  similar: 'layers',
  no: 'search',
  notice: 'cloud-off',
}

export type QueryAnswerProps = Omit<
  ComponentPropsWithRef<'div'>,
  'title' | 'role'
> & {
  tone: QueryAnswerTone
  /** Título en font-display: «Sí, la tienes». */
  title: ReactNode
  /** Dato secundario bajo el título: «2 ejemplares». */
  detail?: ReactNode
  /**
   * Enlace de acción, a la derecha en escritorio y debajo hasta 720 px:
   * <Link className="orki-link orki-answer__action">Ver en mi colección
   * <Icon name="arrow-right" /></Link>. Para que mida 44 px de alto sin
   * mover nada (#174), añade `min-h-[44px] publico-estrecho:-mt-[2px]
   * publico-estrecho:-mb-[10px]` (debajo, el margen negativo descuenta lo
   * que crece sobre la línea de 24 px).
   */
  action?: ReactNode
  /** Icono del círculo; por defecto, el del tono. */
  icon?: IconName
  /**
   * Si es su propia región de estado (role="status"). Por defecto, sí. Con
   * false la anuncia quien la contiene (una región ya montada).
   */
  announce?: boolean
  /** Texto adicional bajo el dato (orki-answer__text), como el nombre buscado. */
  children?: ReactNode
}

// Resultado de una consulta (orki-answer, #206): icono redondo, título, dato
// secundario y, opcionalmente, una acción. Es la pieza de «¿Ya la tengo?»
// (OwnershipAnswer la usa) y vale para cualquier respuesta breve con tono.
// Lleva role="status" para que el lector de pantalla la anuncie: déjala
// montada y cambia su contenido (o pásale announce={false} dentro de una región
// ya montada). La acción va dentro de la región: si el resultado cambia en
// cada pulsación, mejor announce={false} y la región solo alrededor del texto.
export function QueryAnswer({
  tone,
  title,
  detail,
  action,
  icon,
  announce = true,
  className,
  children,
  ...props
}: QueryAnswerProps) {
  const classes = [
    'orki-answer',
    tone !== 'no' && `orki-answer--${tone}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div {...props} className={classes} role={announce ? 'status' : undefined}>
      <span className="orki-answer__icon">
        <Icon name={icon ?? DEFAULT_ICON[tone]} />
      </span>
      <div className="orki-answer__body">
        <p className="orki-answer__title">{title}</p>
        {detail != null && <p className="orki-answer__detail">{detail}</p>}
        {children}
        {action}
      </div>
    </div>
  )
}
