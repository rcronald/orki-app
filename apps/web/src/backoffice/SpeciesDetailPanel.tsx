import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from '../components/ui/Button.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import type { CatalogSpeciesDetail } from '../lib/catalogAdmin.ts'
import {
  toCatalogWriteError,
  type WrittenSpecies,
} from '../lib/catalogWrites.ts'
import { catalogueOfLifeTaxonUrl } from './attribution.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { LoadError, SpeciesStatusBadge } from './parts.tsx'
import { revealPanel, SIDE_PANEL } from './side-panel.ts'
import type { CatalogAdminSource } from './source.ts'
import { SpeciesForm } from './SpeciesForm.tsx'
import { SpeciesHistory } from './SpeciesHistory.tsx'
import { SpeciesMergeDialog } from './SpeciesMergeDialog.tsx'
import { SpeciesNames } from './SpeciesNames.tsx'
import { SpeciesReferencePhoto } from './SpeciesReferencePhoto.tsx'
import {
  formatCount,
  formatDateTime,
  plantCountText,
  SOURCE_LABEL,
  STATUS_LABEL,
  TYPE_LABEL,
} from './texts.ts'
import type { RemoteData } from './useRemoteData.ts'

export interface SpeciesDetailData {
  /** null si la especie ya no existe. */
  species: CatalogSpeciesDetail | null
  plantCount: number
}

export interface SpeciesDetailPanelProps {
  detail: RemoteData<SpeciesDetailData> & { retry: () => void }
  onClose: () => void
  /** Cambia cada vez que la persona abre un detalle: el foco va al título. */
  focusRequest: number
  source: CatalogAdminSource
  /** Se guardó un cambio: la pantalla vuelve a leer y lo anuncia. */
  onChanged: (message: string) => void
  /** Se borró la especie: la pantalla cierra el detalle. */
  onDeleted: (message: string) => void
  /**
   * Se fusionó con otra especie: la pantalla abre la conservada (que puede
   * ser esta), vuelve a leer y lo anuncia.
   */
  onMerged: (keptId: string, message: string) => void
  /** Cambia tras cada escritura: el historial se vuelve a leer. */
  revision?: number
  /** Aviso del resultado de la última escritura (ResultNotice), bajo el título. */
  notice?: ReactNode
}

// Detalle de una especie, en un panel junto a la tabla que se queda a la vista
// al desplazar (debajo en pantallas estrechas; ver SIDE_PANEL): nombres alternativos, referencia de la fuente con enlace a la
// ficha del Catalogue of Life, fechas y número de plantas enlazadas. Desde
// aquí se edita (nombre, género, tipo y estado), se borra si no tiene plantas
// enlazadas, se fusiona con otra (SpeciesMergeDialog) y se editan sus
// sinónimos y nombres comunes (SpeciesNames). Se ve su foto de referencia y
// se puede retirar (SpeciesReferencePhoto, #234). Al final, su historial de
// cambios (SpeciesHistory), también mientras se edita.
export function SpeciesDetailPanel({
  detail,
  onClose,
  focusRequest,
  source,
  onChanged,
  onDeleted,
  onMerged,
  revision = 0,
  notice,
}: SpeciesDetailPanelProps) {
  const headingId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const ready = detail.status !== 'loading'
  const [editing, setEditing] = useState(false)
  const [localFocus, setLocalFocus] = useState(0)

  useEffect(() => {
    if (focusRequest > 0 && ready)
      revealPanel(panelRef.current, headingRef.current)
  }, [focusRequest, ready])
  useEffect(() => {
    if (localFocus > 0) headingRef.current?.focus()
  }, [localFocus])

  const species = detail.status === 'success' ? detail.data.species : null
  // Otra especie: se sale de la edición.
  const speciesId = species?.id ?? null
  const [editingId, setEditingId] = useState(speciesId)
  if (editingId !== speciesId) {
    setEditingId(speciesId)
    setEditing(false)
  }

  return (
    <section
      ref={panelRef}
      aria-labelledby={headingId}
      aria-busy={!ready}
      className={`${SIDE_PANEL} gap-space-3`}
    >
      <div className="flex items-start justify-between gap-space-3">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="min-w-[0] text-lg font-semibold text-secondary [overflow-wrap:anywhere]"
        >
          {species ? (
            <>
              <span className="sr-only">Detalle de</span>{' '}
              <span className="scientific-name text-neutral-900">
                <ScientificName name={species.scientificName} />
              </span>
            </>
          ) : (
            'Detalle de la especie'
          )}
        </h2>
        <Button icon="x" onClick={onClose} className="flex-none">
          Cerrar
        </Button>
      </div>
      {notice}

      {detail.status === 'loading' || detail.status === 'idle' ? (
        <>
          <p role="status" className="sr-only">
            Cargando el detalle…
          </p>
          <div aria-hidden="true" className="flex flex-col gap-space-2">
            {['w-3/4', 'w-1/2', 'w-full', 'w-1/2'].map((width, index) => (
              <div
                key={index}
                className={`h-space-4 rounded-sm bg-neutral-0 motion-safe:animate-pulse ${width}`}
              />
            ))}
          </div>
        </>
      ) : detail.status === 'error' ? (
        <LoadError
          compact
          reason={detail.reason}
          message={detail.message}
          onRetry={detail.retry}
        />
      ) : species === null ? (
        <p className="text-md text-neutral-900">
          Esta especie ya no está en el catálogo.
        </p>
      ) : editing ? (
        <SpeciesForm
          species={species}
          plantCount={detail.data.plantCount}
          source={source}
          onCancel={() => {
            setEditing(false)
            setLocalFocus((value) => value + 1)
          }}
          onSaved={(written, autoValidated) => {
            setEditing(false)
            setLocalFocus((value) => value + 1)
            onChanged(savedMessage(species, written, autoValidated))
          }}
        />
      ) : (
        <DetailBody
          species={species}
          plantCount={detail.data.plantCount}
          source={source}
          onEdit={() => setEditing(true)}
          onDeleted={onDeleted}
          onChanged={onChanged}
          onMerged={onMerged}
          heading={() => headingRef.current}
        />
      )}
      {species && (
        <SpeciesHistory species={species} source={source} revision={revision} />
      )}
    </section>
  )
}

function savedMessage(
  before: CatalogSpeciesDetail,
  written: WrittenSpecies,
  autoValidated: boolean,
): string {
  const name = `«${written.scientificName}»`
  if (autoValidated) {
    return `Se guardaron los cambios de ${name}. Pasó a «Validada» porque era importada y cambiaron sus datos: la importación ya no la pisará.`
  }
  if (
    before.status !== written.status &&
    before.scientificName === written.scientificName &&
    before.genusId === written.genusId &&
    before.type === written.type
  ) {
    return `${name} pasó a «${STATUS_LABEL[written.status]}».`
  }
  return `Se guardaron los cambios de ${name}.`
}

const TERM = 'text-sm font-semibold text-neutral-700'
const VALUE = 'text-md text-neutral-900 [overflow-wrap:anywhere]'

function DetailBody({
  species,
  plantCount,
  source,
  onEdit,
  onDeleted,
  onChanged,
  onMerged,
  heading,
}: {
  species: CatalogSpeciesDetail
  plantCount: number
  source: CatalogAdminSource
  onEdit: () => void
  onDeleted: (message: string) => void
  onChanged: (message: string) => void
  onMerged: (keptId: string, message: string) => void
  /** El título del panel, adonde va el foco tras fusionar. */
  heading: () => HTMLElement | null
}) {
  const synonyms = species.names.filter((name) => name.type === 'synonym')
  const commonNames = species.names.filter((name) => name.type === 'common')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)
  // Tras fusionar (o si la especie ya no existe), el foco va al título del
  // panel en lugar de al botón que abrió el diálogo, que desaparece.
  const mergeDone = useRef(false)

  const remove = async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      await source.deleteSpecies(species.id)
      setConfirmDelete(false)
      onDeleted(`Se borró «${species.scientificName}» del catálogo.`)
    } catch (caught) {
      setDeleting(false)
      setDeleteError(toCatalogWriteError(caught).message)
    }
  }

  return (
    <>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-space-3 gap-y-space-2">
        <dt className={TERM}>Género</dt>
        <dd className={VALUE}>{species.genusName}</dd>
        <dt className={TERM}>Tipo</dt>
        <dd className={VALUE}>{TYPE_LABEL[species.type]}</dd>
        <dt className={TERM}>Estado</dt>
        <dd className={VALUE}>
          <SpeciesStatusBadge status={species.status} />
        </dd>
        <dt className={TERM}>Fuente</dt>
        <dd className={VALUE}>{SOURCE_LABEL[species.source]}</dd>
        <dt className={TERM}>Referencia</dt>
        <dd className={VALUE}>
          {species.sourceRef === null ? (
            'Sin referencia'
          ) : species.source === 'col' ? (
            <a
              className="font-semibold text-secondary underline"
              href={catalogueOfLifeTaxonUrl(species.sourceRef)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {species.sourceRef}{' '}
              <span className="font-normal">
                · Ver la ficha en el <span lang="en">Catalogue of Life</span>
              </span>{' '}
              <span className="sr-only">(se abre en otra pestaña)</span>
            </a>
          ) : (
            species.sourceRef
          )}
        </dd>
        <dt className={TERM}>Alta</dt>
        <dd className={VALUE}>{formatDateTime(species.createdAt)}</dd>
        <dt className={TERM}>Última modificación</dt>
        <dd className={VALUE}>{formatDateTime(species.updatedAt)}</dd>
        <dt className={TERM}>Plantas</dt>
        <dd className={VALUE}>{plantCountText(plantCount)}</dd>
      </dl>
      <div className="flex flex-wrap gap-space-3">
        <Button icon="pencil" onClick={onEdit}>
          Editar <span className="sr-only">la especie</span>
        </Button>
        {plantCount === 0 && (
          <Button
            variant="danger"
            icon="trash-2"
            onClick={() => {
              setDeleteError(null)
              setConfirmDelete(true)
            }}
          >
            Borrar <span className="sr-only">la especie</span>
          </Button>
        )}
        <Button
          aria-haspopup="dialog"
          onClick={() => {
            mergeDone.current = false
            setMerging(true)
          }}
        >
          Fusionar con otra especie
        </Button>
      </div>
      {plantCount > 0 && (
        <p className="text-sm text-neutral-700">
          No se puede borrar: {plantCountText(plantCount).toLowerCase()} Si es
          un duplicado, puedes fusionarla con otra especie: sus plantas y sus
          nombres pasarán a la que se conserve. Si no, puedes marcarla como
          «Observada».
        </p>
      )}
      {merging && (
        <SpeciesMergeDialog
          species={species}
          source={source}
          onCancel={() => setMerging(false)}
          onMerged={(keptId, message) => {
            mergeDone.current = true
            setMerging(false)
            onMerged(keptId, message)
          }}
          onSpeciesGone={(message) => {
            mergeDone.current = true
            setMerging(false)
            onChanged(message)
          }}
          returnFocusTo={() => (mergeDone.current ? heading() : null)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Borrar «${species.scientificName}»`}
          confirmLabel="Borrar del catálogo"
          variant="danger"
          busy={deleting}
          busyText="Borrando…"
          error={deleteError}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        >
          <p>
            Se borra del catálogo
            {species.names.length > 0
              ? ` junto con ${namesText(synonyms.length, commonNames.length)}`
              : ''}
            . No se puede deshacer.
          </p>
          <p>Ninguna planta de usuarios la tiene enlazada.</p>
        </ConfirmDialog>
      )}
      <SpeciesReferencePhoto
        species={species}
        source={source}
        onChanged={onChanged}
      />
      <SpeciesNames species={species} source={source} onChanged={onChanged} />
    </>
  )
}

function namesText(synonyms: number, common: number): string {
  const parts = [
    synonyms > 0 &&
      `${formatCount(synonyms)} ${synonyms === 1 ? 'sinónimo' : 'sinónimos'}`,
    common > 0 &&
      `${formatCount(common)} ${common === 1 ? 'nombre común' : 'nombres comunes'}`,
  ].filter(Boolean)
  return parts.join(' y ')
}
