import { useId } from 'react'
import { Link } from 'react-router'
import { useCollection } from '../collection/useCollection.ts'
import { useReadOnly } from '../collection/useReadOnly.ts'
import { Icon } from '../components/ui/Icon.tsx'
import { QueryAnswer } from '../components/ui/QueryAnswer.tsx'
import type { PublicSpecies } from '../lib/publicCatalog.ts'
import { newPlantLinkForSpecies } from '../registration/prefill-name.ts'
import { PATHS } from '../routes/paths.ts'
import { CATALOG_TEXT } from './texts.ts'

/** Ejemplares activos de la colección enlazados a la especie. */
function ownedCount(
  plants: readonly { status: string; species: { id: string } | null }[],
  speciesId: string,
): number {
  return plants.filter(
    (plant) => plant.status === 'active' && plant.species?.id === speciesId,
  ).length
}

/**
 * Con sesión, en la ficha (#232): «La tienes» (cuántos ejemplares activos
 * tiene enlazados a esta especie, con «Ver en mi colección», que abre el
 * inventario buscando su nombre) o «Aún no la tienes», y «Registrar esta
 * especie», que abre el registro con ella ya elegida.
 *
 * - Sale de la colección que ya comparte la app (useCollection: la de la red
 *   o, sin conexión, la copia del dispositivo); no hace otra consulta. Su
 *   usuario dice si hay sesión (también una sin confirmar, sin conexión), así
 *   este chunk no necesita Clerk. Sin sesión, nada.
 * - Mientras no hay datos, un texto de espera; si no se pudieron leer, no se
 *   afirma nada (no es lo mismo que «no la tienes»).
 * - Sin conexión o con la sesión sin confirmar, registrar queda desactivado
 *   con el motivo, como en el resto de la app.
 */
export function SpeciesOwnership({ species }: { species: PublicSpecies }) {
  const { userId, plants, status } = useCollection()
  const readOnly = useReadOnly()
  const reasonId = useId()
  if (userId === null) return null

  const count = plants === null ? null : ownedCount(plants, species.id)
  const link = newPlantLinkForSpecies({
    id: species.id,
    scientificName: species.scientificName,
    genus: species.genus,
    type: species.type,
  })
  const collectionLink = `${PATHS.collection}?${new URLSearchParams({ q: species.scientificName }).toString()}`

  return (
    <div className="flex flex-col gap-space-3">
      {count === null ? (
        status === 'error' ? null : (
          <p role="status" className="text-md text-neutral-700">
            {CATALOG_TEXT.checkingCollection}
          </p>
        )
      ) : count > 0 ? (
        <QueryAnswer
          tone="yes"
          title={CATALOG_TEXT.owned}
          detail={CATALOG_TEXT.ownedDetail(count)}
          action={
            <Link
              to={collectionLink}
              className="orki-link orki-answer__action min-h-[44px] publico-estrecho:-mt-[2px] publico-estrecho:-mb-[10px]"
            >
              {CATALOG_TEXT.viewInCollection}
              <Icon name="arrow-right" />
            </Link>
          }
        />
      ) : (
        <QueryAnswer tone="no" title={CATALOG_TEXT.notOwned} />
      )}
      {readOnly === null ? (
        <Link
          to={link.to}
          state={link.state}
          className={`orki-btn self-start ${count === 0 ? 'orki-btn--primary' : 'orki-btn--secondary'}`}
        >
          <Icon name="plus" />
          {CATALOG_TEXT.register}
        </Link>
      ) : (
        <>
          <button
            type="button"
            aria-disabled="true"
            aria-describedby={reasonId}
            className="orki-btn orki-btn--secondary self-start"
          >
            <Icon name="plus" />
            {CATALOG_TEXT.register}
          </button>
          <p id={reasonId} className="text-sm text-neutral-700">
            {CATALOG_TEXT.registerOffline}
          </p>
        </>
      )}
    </div>
  )
}
