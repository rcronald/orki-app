import { useId, useMemo } from 'react'
import { Link } from 'react-router'
import { useCollection } from '../collection/useCollection.ts'
import { useReadOnly } from '../collection/useReadOnly.ts'
import { Icon } from '../components/ui/Icon.tsx'
import { QueryAnswer } from '../components/ui/QueryAnswer.tsx'
import { pastSpecimensText } from '../inventory/texts.ts'
import type { PublicSpecies } from '../lib/publicCatalog.ts'
import { newPlantLinkForSpecies } from '../registration/prefill-name.ts'
import { PATHS } from '../routes/paths.ts'
import { speciesOwnershipOf, unlinkedLink } from './species-ownership.ts'
import { CATALOG_TEXT } from './texts.ts'

const ACTION_CLASS =
  'orki-link orki-answer__action min-h-[44px] publico-estrecho:-mt-[2px] publico-estrecho:-mb-[10px]'

/**
 * Con sesión, en la ficha (#232, #296), con el criterio de «¿Ya la tengo?»
 * (species-ownership.ts):
 *
 * - «La tienes» (tono yes): cuántos ejemplares activos tiene enlazados a esta
 *   especie, con «Ver en mi colección», que abre el inventario buscando su
 *   nombre. Si además hay alguno sin validar con su nombre, se menciona.
 * - «Podrías tenerla» (tono similar): ninguno enlazado, pero alguno activo sin
 *   validar con el nombre aceptado, un sinónimo de la ficha o la abreviatura
 *   del género. Enlaza a su ficha (o al inventario filtrado si son varios), y
 *   «Registrar esta especie» deja de ser la acción principal.
 * - «Aún no la tienes» (tono no), o «No, pero la tuviste» si hay perdidos o
 *   regalados. Es definitiva sin esperar a los extras de la colección
 *   (useExtrasState, #274): los enlazados se cuentan por el id de la especie,
 *   y los sin validar no tienen especie cuyos sinónimos falten; los nombres de
 *   esta especie vienen en la ficha.
 * - Los dados de baja nunca dan un «sí»: se mencionan aparte.
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
  const ownership = useMemo(
    () => (plants === null ? null : speciesOwnershipOf(plants, species)),
    [plants, species],
  )
  if (userId === null) return null

  const link = newPlantLinkForSpecies({
    id: species.id,
    scientificName: species.scientificName,
    genus: species.genus,
    type: species.type,
  })
  const collectionLink = `${PATHS.collection}?${new URLSearchParams({ q: species.scientificName }).toString()}`
  const owned = ownership !== null && ownership.linked.length > 0
  const maybe = ownership !== null && !owned && ownership.unlinked.length > 0
  const past =
    ownership === null
      ? null
      : pastSpecimensText(ownership.lost, ownership.gifted, owned || maybe)
  const allPending =
    ownership?.unlinked.every((plant) => plant.validation === 'pending') ?? true

  return (
    <div className="flex flex-col gap-space-3">
      {ownership === null ? (
        status === 'error' ? null : (
          <p role="status" className="text-md text-neutral-700">
            {CATALOG_TEXT.checkingCollection}
          </p>
        )
      ) : owned ? (
        <QueryAnswer
          tone="yes"
          title={CATALOG_TEXT.owned}
          detail={CATALOG_TEXT.ownedDetail(ownership.linked.length)}
          action={
            <Link to={collectionLink} className={ACTION_CLASS}>
              {CATALOG_TEXT.viewInCollection}
              <Icon name="arrow-right" />
            </Link>
          }
        >
          {ownership.unlinked.length > 0 && (
            <p className="orki-answer__text">
              {CATALOG_TEXT.unlinkedAlso(ownership.unlinked.length, allPending)}
            </p>
          )}
          {past !== null && <p className="orki-answer__text">{past}</p>}
        </QueryAnswer>
      ) : maybe ? (
        <QueryAnswer
          tone="similar"
          title={CATALOG_TEXT.maybeOwned}
          detail={CATALOG_TEXT.unlinkedDetail(
            ownership.unlinked.length,
            allPending,
          )}
          action={
            <Link
              to={unlinkedLink(ownership.unlinked, species.scientificName)}
              className={ACTION_CLASS}
            >
              {ownership.unlinked.length === 1
                ? CATALOG_TEXT.viewSpecimen
                : CATALOG_TEXT.viewSpecimens}
              <Icon name="arrow-right" />
            </Link>
          }
        >
          <p className="orki-answer__text">{CATALOG_TEXT.unlinkedHint}</p>
          {past !== null && <p className="orki-answer__text">{past}</p>}
        </QueryAnswer>
      ) : (
        <QueryAnswer
          tone="no"
          title={past === null ? CATALOG_TEXT.notOwned : CATALOG_TEXT.hadIt}
        >
          {past !== null && <p className="orki-answer__text">{past}</p>}
        </QueryAnswer>
      )}
      {readOnly === null ? (
        <Link
          to={link.to}
          state={link.state}
          className={`orki-btn self-start ${ownership !== null && !owned && !maybe ? 'orki-btn--primary' : 'orki-btn--secondary'}`}
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
