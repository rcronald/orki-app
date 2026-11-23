import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { Ownership } from '../collection/ownership.ts'
import { Icon } from '../components/ui/Icon.tsx'
import { QueryAnswer } from '../components/ui/QueryAnswer.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import { OWNERSHIP_TEXT, pastSpecimensText } from '../inventory/texts.ts'
import { ownershipSubject } from '../inventory/useOwnershipAnswer.ts'
import { CHECK_TEXT, specimenCountText } from './texts.ts'

/**
 * Por qué un «no» no es seguro (#274): faltan los sinónimos, nombres comunes o
 * abreviaturas de alguna planta y se están pidiendo (pending), no se pudieron
 * pedir (failed) o no hay conexión para pedirlos (offline).
 */
export type UnconfirmedNo = 'pending' | 'failed' | 'offline'

interface CheckAnswerProps {
  ownership: Ownership
  /** Lo escrito, sin espacios de sobra. */
  typed: string
  /** Nombre del catálogo si lo escrito es una sola especie que no tiene. */
  catalogName: string | null
  /** «Ver en mi colección»; null sin enlace. */
  collectionLink: string | null
  /** Si un «no» no es seguro, por qué (#274); null o sin él, lo es. */
  unconfirmed?: UnconfirmedNo | null
}

// La respuesta de «¿Ya la tengo?» en su pantalla (#209), con QueryAnswer:
//
// - «Sí, la tienes» (yes): cuántos ejemplares activos y de qué; por género,
//   cuántos de ese género (y de cada uno, si son varios).
// - «Tienes parecidas» (similar): solo se parecen dentro de la tolerancia de
//   errores de tipeo; se muestran para que la persona juzgue.
// - «No, pero la tuviste» (no): ninguno activo, pero sí perdidos o regalados.
// - «Aún no la tienes» (no): ninguno.
// - Si faltan los sinónimos, nombres comunes o abreviaturas de alguna planta
//   (#274), un «no» no es seguro y no se dice: «Comprobando sinónimos y
//   abreviaturas…» (tono no, neutro) mientras llegan, que se resuelve solo;
//   si no se pudieron pedir, «No pudimos comprobarlo todo» (tono notice),
//   con lo que falta. Las positivas no esperan.
//
// Sin región propia (announce={false}): la pantalla la pinta dentro de una
// región role="status" siempre montada.
export function CheckAnswer({
  ownership,
  typed,
  catalogName,
  collectionLink,
  unconfirmed = null,
}: CheckAnswerProps) {
  const lost = ownership.pastMatches.filter(
    ({ plant }) => plant.status === 'lost',
  ).length
  const gifted = ownership.pastMatches.filter(
    ({ plant }) => plant.status === 'gifted',
  ).length
  const ownedNow = ownership.matches.length > 0
  const past = pastSpecimensText(lost, gifted, ownedNow)
  const action =
    collectionLink === null ? undefined : (
      <Link
        to={collectionLink}
        className="orki-link orki-answer__action min-h-[44px] publico-estrecho:-mt-[2px] publico-estrecho:-mb-[10px]"
      >
        {CHECK_TEXT.seeInCollection}
        <Icon name="arrow-right" />
      </Link>
    )

  if (ownership.outcome === 'not-owned') {
    const name = catalogName === null ? `«${typed}»` : italic(catalogName)
    if (unconfirmed !== null) {
      const pending = unconfirmed === 'pending'
      return (
        <QueryAnswer
          tone={pending ? 'no' : 'notice'}
          icon={unconfirmed === 'failed' ? 'triangle-alert' : undefined}
          announce={false}
          title={
            pending
              ? CHECK_TEXT.unconfirmed.pending
              : CHECK_TEXT.unconfirmed.unchecked
          }
          detail={
            pending ? (
              <>No encontramos {name} por su nombre en tu colección.</>
            ) : unconfirmed === 'offline' ? (
              <>
                No encontramos {name} por su nombre, pero sin conexión no
                podemos comprobar sinónimos ni abreviaturas.
              </>
            ) : (
              <>
                No encontramos {name} por su nombre, pero no pudimos comprobar
                sinónimos ni abreviaturas.
              </>
            )
          }
        >
          {unconfirmed === 'offline' && (
            <p className="orki-answer__text">
              {CHECK_TEXT.unconfirmed.whenOnline}
            </p>
          )}
          {past !== null && <p className="orki-answer__text">{past}</p>}
        </QueryAnswer>
      )
    }
    return (
      <QueryAnswer
        tone="no"
        announce={false}
        title={past === null ? CHECK_TEXT.no : CHECK_TEXT.had}
        detail={<>{name} no está en tu colección.</>}
        action={past === null ? undefined : action}
      >
        {past !== null && <p className="orki-answer__text">{past}</p>}
      </QueryAnswer>
    )
  }

  const count = ownership.matches.length
  const similar = ownership.outcome === 'similar'
  return (
    <QueryAnswer
      tone={similar ? 'similar' : 'yes'}
      announce={false}
      title={similar ? CHECK_TEXT.similar : CHECK_TEXT.yes}
      detail={
        <>
          {specimenCountText(count)} {subjectPhrase(ownership, typed)}
        </>
      }
      action={action}
    >
      {ownership.scope === 'genus' && ownership.genera.length > 1 && (
        <p className="orki-answer__text">
          {ownership.genera
            .map(
              ({ genus, activeCount }) =>
                `${genus.name}: ${specimenCountText(activeCount)}`,
            )
            .join('. ')}
          .
        </p>
      )}
      {similar && <p className="orki-answer__text">{OWNERSHIP_TEXT.similar}</p>}
      {past !== null && <p className="orki-answer__text">{past}</p>}
    </QueryAnswer>
  )
}

function italic(name: string): ReactNode {
  return (
    <em className="font-display">
      <ScientificName name={name} />
    </em>
  )
}

/** "de Cattleya maxima", "del género Cattleya", "que coinciden con «phal»". */
function subjectPhrase(ownership: Ownership, typed: string): ReactNode {
  const subject = ownershipSubject(ownership, typed)
  if (ownership.scope === 'genus') {
    return ownership.genera.length > 1 ? (
      <>de los géneros {subject}</>
    ) : (
      <>del género {italic(subject)}</>
    )
  }
  const names = new Set(ownership.matches.map(({ plant }) => plant.displayName))
  if (names.size !== 1) return <>que coinciden con «{typed}»</>
  const plant = ownership.matches[0]?.plant
  // Un nombre por validar va en redonda, como en el resto de la app.
  if (plant !== undefined && !plant.displayNameIsScientific) {
    return <>de {subject}</>
  }
  return <>de {italic(subject)}</>
}
