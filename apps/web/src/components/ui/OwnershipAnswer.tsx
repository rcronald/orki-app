import type { ComponentPropsWithRef } from 'react'
import { Icon } from './Icon.tsx'

type AnswerContent =
  | {
      /** Sí, la tienes. */
      owned: true
      /** Cuántos ejemplares de la especie hay en la colección. */
      specimenCount: number
    }
  | {
      /** Aún no la tienes: respuesta neutra, no un error. */
      owned: false
      specimenCount?: never
    }

export type OwnershipAnswerProps = Omit<
  ComponentPropsWithRef<'div'>,
  'children' | 'role'
> &
  AnswerContent & {
    /** Nombre científico buscado; se muestra en cursiva dentro de <em>. */
    scientificName: string
    /**
     * Si es su propia región de estado (role="status"). Por defecto, sí. Con
     * false la anuncia quien la contiene: por ejemplo, una región ya montada
     * en la que la respuesta aparece y cambia mientras se escribe.
     */
    announce?: boolean
  }

// Respuesta de "¿Ya la tengo?" (orki-answer). Lleva role="status" para que el
// lector de pantalla la anuncie: déjala montada y cambia su contenido (o
// pásale announce={false} y ponla dentro de una región que ya esté montada).
// La negativa es neutra, sin rojo; debajo puede ir un Button primario
// "Registrar orquídea".
export function OwnershipAnswer({
  owned,
  specimenCount,
  scientificName,
  announce = true,
  className,
  ...props
}: OwnershipAnswerProps) {
  const classes = ['orki-answer', owned && 'orki-answer--yes', className]
    .filter(Boolean)
    .join(' ')
  const name = <em>{scientificName}</em>

  return (
    <div {...props} className={classes} role={announce ? 'status' : undefined}>
      <span className="orki-answer__icon">
        <Icon name={owned ? 'check' : 'search'} />
      </span>
      <div>
        <p className="orki-answer__title">
          {owned ? 'Sí, la tienes' : 'Aún no la tienes'}
        </p>
        <p className="orki-answer__text">
          {owned ? (
            <>
              Tienes {specimenCount}{' '}
              {specimenCount === 1 ? 'ejemplar' : 'ejemplares'} de {name}.
            </>
          ) : (
            <>{name} no está en tu colección.</>
          )}
        </p>
      </div>
    </div>
  )
}
