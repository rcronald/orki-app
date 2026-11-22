import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { Ownership } from '../collection/ownership.ts'
import { Icon } from '../components/ui/Icon.tsx'
import { QueryAnswer } from '../components/ui/QueryAnswer.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import { OWNERSHIP_TEXT, pastSpecimensText } from '../inventory/texts.ts'
import { ownershipSubject } from '../inventory/useOwnershipAnswer.ts'
import { CHECK_TEXT, specimenCountText } from './texts.ts'

interface CheckAnswerProps {
  ownership: Ownership
  /** Lo escrito, sin espacios de sobra. */
  typed: string
  /** Nombre del catálogo si lo escrito es una sola especie que no tiene. */
  catalogName: string | null
  /** «Ver en mi colección»; null sin enlace. */
  collectionLink: string | null
}

// La respuesta de «¿Ya la tengo?» en su pantalla (#209), con QueryAnswer:
//
// - «Sí, la tienes» (yes): cuántos ejemplares activos y de qué; por género,
//   cuántos de ese género (y de cada uno, si son varios).
// - «Tienes parecidas» (similar): solo se parecen dentro de la tolerancia de
//   errores de tipeo; se muestran para que la persona juzgue.
// - «No, pero la tuviste» (no): ninguno activo, pero sí perdidos o regalados.
// - «Aún no la tienes» (no): ninguno.
//
// Sin región propia (announce={false}): la pantalla la pinta dentro de una
// región role="status" siempre montada.
export function CheckAnswer({
  ownership,
  typed,
  catalogName,
  collectionLink,
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
      <Link to={collectionLink} className="orki-link orki-answer__action">
        {CHECK_TEXT.seeInCollection}
        <Icon name="arrow-right" />
      </Link>
    )

  if (ownership.outcome === 'not-owned') {
    const name = catalogName === null ? `«${typed}»` : italic(catalogName)
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
