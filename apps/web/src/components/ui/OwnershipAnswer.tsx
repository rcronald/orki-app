import type { ReactNode } from 'react'
import { QueryAnswer, type QueryAnswerProps } from './QueryAnswer.tsx'

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
  QueryAnswerProps,
  'tone' | 'title' | 'detail' | 'children'
> &
  AnswerContent & {
    /** Nombre científico buscado; se muestra en cursiva dentro de <em>. */
    scientificName: string
  }

// Respuesta de "¿Ya la tengo?" con el texto de la pantalla de inventario,
// sobre QueryAnswer (orki-answer): «Sí, la tienes» (tono yes) con «Tienes N
// ejemplares de <em>nombre</em>.», o «Aún no la tienes» (tono no, neutro, sin
// rojo). Lleva role="status" salvo announce={false}. Admite la misma acción
// que QueryAnswer («Ver en mi colección →»). Debajo puede ir un Button
// primario "Registrar orquídea".
export function OwnershipAnswer({
  owned,
  specimenCount,
  scientificName,
  ...props
}: OwnershipAnswerProps) {
  const name = <em>{scientificName}</em>
  let text: ReactNode
  if (owned) {
    text = (
      <>
        Tienes {specimenCount} {specimenCount === 1 ? 'ejemplar' : 'ejemplares'}{' '}
        de {name}.
      </>
    )
  } else {
    text = <>{name} no está en tu colección.</>
  }

  return (
    <QueryAnswer
      {...props}
      tone={owned ? 'yes' : 'no'}
      title={owned ? 'Sí, la tienes' : 'Aún no la tienes'}
    >
      <p className="orki-answer__text">{text}</p>
    </QueryAnswer>
  )
}
