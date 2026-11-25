import type { ReactNode } from 'react'
import { QueryAnswer, type QueryAnswerProps } from './QueryAnswer.tsx'
import { ScientificName } from './ScientificName.tsx'

/**
 * Cómo se pinta el nombre (#336), como en la pantalla «¿Ya la tengo?»
 * (CheckAnswer): `scientific`, un nombre del catálogo (una especie validada o
 * un género), en cursiva con ScientificName; `entered`, un nombre por validar
 * o una lista de géneros, en redonda; `typed`, lo escrito, entre comillas.
 */
export type OwnershipNameKind = 'scientific' | 'entered' | 'typed'

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
    /** Nombre buscado; cómo se pinta lo dice `nameKind`. */
    scientificName: string
    /** Por defecto, scientific. */
    nameKind?: OwnershipNameKind
  }

// Respuesta de "¿Ya la tengo?" con el texto de la pantalla de inventario,
// sobre QueryAnswer (orki-answer): «Sí, la tienes» (tono yes) con «Tienes N
// ejemplares de nombre.», o «Aún no la tienes» (tono no, neutro, sin
// rojo). Lleva role="status" salvo announce={false}. Admite la misma acción
// que QueryAnswer («Ver en mi colección →»). Debajo puede ir un Button
// primario "Registrar orquídea".
export function OwnershipAnswer({
  owned,
  specimenCount,
  scientificName,
  nameKind = 'scientific',
  ...props
}: OwnershipAnswerProps) {
  const name =
    nameKind === 'scientific' ? (
      <em className="font-display">
        <ScientificName name={scientificName} />
      </em>
    ) : nameKind === 'typed' ? (
      `«${scientificName}»`
    ) : (
      scientificName
    )
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
