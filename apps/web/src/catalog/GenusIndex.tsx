import { useMemo } from 'react'
import { Link } from 'react-router'
import { ActionList } from '../components/ui/ActionRow.tsx'
import { listAllPublicGenera, type PublicGenus } from '../lib/publicCatalog.ts'
import { CatalogError, CatalogLoading } from './CatalogStates.tsx'
import {
  activeLetter,
  genusLetter,
  lettersOf,
  OTHER_LETTER,
} from './letters.ts'
import { catalogGenusPath, catalogHomePath } from './paths.ts'
import { SpeciesRow } from './SearchResults.tsx'
import { CATALOG_TEXT, generaCountText, speciesCountText } from './texts.ts'
import { useCatalogData } from './useCatalogData.ts'

/** Clave de la lista de géneros en la memoria de la visita (useCatalogData). */
export const GENERA_KEY = 'generos'

/**
 * Géneros del catálogo por letra (#232).
 *
 * - Se cargan todos al abrir la sección (unos 755 en pocas peticiones, ver
 *   listAllPublicGenera: unos 40 kB) y se guardan en la memoria de la visita;
 *   el índice y el cambio de letra no piden nada más.
 * - Se muestran por letra (?letra=, la primera si no hay o no existe), en el
 *   orden de la base: sin tildes ni el signo «×», así los nothogéneros van con
 *   su letra y no al principio ni al final.
 * - Cada letra es un enlace con su dirección (aria-current en la elegida) y el
 *   número de géneros de la letra se anuncia en una región role="status".
 */
export function GenusIndex({ letter }: { letter: string | null }) {
  const genera = useCatalogData(GENERA_KEY, (signal) =>
    listAllPublicGenera({ signal }),
  )

  return (
    <section
      aria-labelledby="catalogo-generos"
      className="flex flex-col gap-space-4"
    >
      <h2
        id="catalogo-generos"
        className="font-display text-xl font-semibold text-secondary-strong"
      >
        {CATALOG_TEXT.generaTitle}
      </h2>
      {genera.status === 'error' ? (
        <CatalogError reason={genera.reason} onRetry={genera.retry} />
      ) : genera.status === 'success' ? (
        <GenusLetters genera={genera.data} requested={letter} />
      ) : (
        <CatalogLoading>{CATALOG_TEXT.loadingGenera}</CatalogLoading>
      )}
    </section>
  )
}

function letterLabel(letter: string): string {
  return letter === OTHER_LETTER
    ? CATALOG_TEXT.otherLetter
    : letter.toUpperCase()
}

function GenusLetters({
  genera,
  requested,
}: {
  genera: readonly PublicGenus[]
  requested: string | null
}) {
  const letters = useMemo(
    () => lettersOf(genera.map((genus) => genus.name)),
    [genera],
  )
  const current = activeLetter(requested, letters)
  const shown = useMemo(
    () => genera.filter((genus) => genusLetter(genus.name) === current),
    [genera, current],
  )
  const speciesTotal = useMemo(
    () => genera.reduce((sum, genus) => sum + genus.speciesCount, 0),
    [genera],
  )

  if (current === null) {
    return <p className="text-md text-neutral-700">{CATALOG_TEXT.noGenera}</p>
  }
  return (
    <>
      <p className="text-md text-neutral-700">
        {generaCountText(genera.length)} · {speciesCountText(speciesTotal)}
      </p>
      <nav aria-label={CATALOG_TEXT.lettersLabel}>
        <ul className="orki-letters">
          {letters.map((item) => (
            <li key={item}>
              <Link
                to={catalogHomePath(item === letters[0] ? null : item)}
                className={`orki-chip orki-letters__link${item === current ? ' orki-chip--selected' : ''}`}
                aria-current={item === current ? 'true' : undefined}
                preventScrollReset
              >
                {letterLabel(item)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <p role="status" className="sr-only">
        {CATALOG_TEXT.generaOfLetter(letterLabel(current), shown.length)}
      </p>
      <ActionList className="[column-gap:var(--space-5)] md:[columns:3] [&>li]:break-inside-avoid">
        {shown.map((genus) => (
          <li key={genus.id}>
            <SpeciesRow
              to={catalogGenusPath(genus.id)}
              name={genus.name}
              details={[speciesCountText(genus.speciesCount)]}
            />
          </li>
        ))}
      </ActionList>
    </>
  )
}
