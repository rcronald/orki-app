import { useEffect, useId, useRef, useState } from 'react'
import { Autocomplete } from '../components/ui/Autocomplete.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import {
  PROPOSAL_PAGE_SIZE,
  proposalGroupId,
  type CatalogSpeciesRow,
  type ProposalGroup,
  type ProposalPhoto,
} from '../lib/catalogAdmin.ts'
import { prepareSearchQuery } from '../lib/catalogSearch.ts'
import {
  toCatalogWriteError,
  type ProposalResolution,
} from '../lib/catalogWrites.ts'
import type { SpeciesType } from '../lib/database.ts'
import { PlantImagesContext, usePlantImage } from '../photos/usePlantImage.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { ModalDialog } from './ModalDialog.tsx'
import { LoadError, Notice, Pagination } from './parts.tsx'
import type { CatalogAdminSource } from './source.ts'
import { SpeciesForm } from './SpeciesForm.tsx'
import {
  formatCount,
  PLANT_TYPE_LABEL,
  proposalGroupCountText,
  proposalPlantCountText,
  STATUS_LABEL,
  TYPE_LABEL,
} from './texts.ts'
import type { ProposalsViewState } from './url-state.ts'
import { SEARCH_DEBOUNCE_MS, useRemoteData } from './useRemoteData.ts'

// Pestaña "Por validar" del backoffice (#140, parte de #22): la cola de
// propuestas de los usuarios, agrupadas por nombre normalizado y género (ver
// supabase/README.md, "Cola de propuestas").
//
// - Cada grupo muestra el nombre propuesto, el género, el tipo, cuántas plantas
//   tiene y sus fotos (botones que la amplían en un diálogo).
// - Tres acciones por grupo, cada una en un diálogo modal y todas con
//   teclado: enlazar a una especie existente (el buscador del catálogo,
//   precargado con el nombre propuesto), crear la especie nueva (el formulario
//   del backoffice ya relleno) o marcar como no identificable (con
//   confirmación).
// - Tras resolver, el grupo sale de la lista al momento (sin esperar a la
//   lectura nueva), la lista y el número de la pestaña se vuelven a leer y el
//   resultado se anuncia en la región de estado de la pantalla.
// - Si otro administrador ya lo había resuelto (la base devuelve 0 plantas),
//   se dice así y se refresca la lista.
//
// Las fotos se piden por su ruta a una fuente propia (source.proposalImages,
// sin caché persistente) y se muestran con una URL de objeto: la ruta, que
// lleva el id del usuario, nunca llega al DOM.

export interface ProposalsTabProps {
  state: ProposalsViewState
  onChange: (next: ProposalsViewState) => void
  source: CatalogAdminSource
  revision: number
  /** Tras una resolución: refresca la pantalla y anuncia el mensaje. */
  onCatalogChanged: (message: string) => void
}

type Action =
  | { kind: 'link'; group: ProposalGroup }
  | { kind: 'create'; group: ProposalGroup }
  | { kind: 'unidentifiable'; group: ProposalGroup }
  | { kind: 'photo'; group: ProposalGroup; index: number }

const SKELETON_GROUPS = 3

export function ProposalsTab({
  state,
  onChange,
  source,
  revision,
  onCatalogChanged,
}: ProposalsTabProps) {
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [action, setAction] = useState<Action | null>(null)
  // Grupos ya resueltos que se ocultan mientras llega la lista nueva.
  const [hidden, setHidden] = useState<readonly string[]>([])

  const list = useRemoteData(
    `propuestas:${state.page}`,
    (signal) => source.listProposals({ page: state.page, signal }),
    { revision },
  )
  const images = source.proposalImages()

  // Si la base devolvió otra página (la pedida ya no existe), la URL la sigue.
  const shownPage = list.status === 'success' ? list.data.page : null
  useEffect(() => {
    if (shownPage !== null && shownPage !== state.page) {
      onChange({ ...state, page: shownPage })
    }
  }, [shownPage, state, onChange])

  const refreshing = list.status === 'success' && list.refreshing === true
  const rows =
    list.status === 'success'
      ? list.data.rows.filter(
          (group) => !refreshing || !hidden.includes(proposalGroupId(group)),
        )
      : null

  const finish = (group: ProposalGroup, message: string) => {
    setHidden([proposalGroupId(group)])
    setAction(null)
    onCatalogChanged(message)
  }

  /** Mensaje de una resolución, o el de "ya estaba resuelto". */
  const resolved = (
    group: ProposalGroup,
    result: ProposalResolution,
    done: (plants: string) => string,
  ) =>
    finish(
      group,
      result.plantCount === 0
        ? `Otro administrador ya resolvió «${group.proposedName}» (${group.genusName}) mientras tanto: no se cambió nada y la lista se actualizó.`
        : done(proposalPlantCountText(result.plantCount)),
    )

  const total = list.status === 'success' ? list.data.total : 0
  const pageCount = Math.max(1, Math.ceil(total / PROPOSAL_PAGE_SIZE))

  return (
    <PlantImagesContext value={images}>
      <section
        aria-labelledby={headingId}
        className="flex flex-col gap-space-4"
      >
        <div className="flex flex-col gap-space-2">
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-xl text-neutral-900 outline-none"
          >
            Propuestas por validar
          </h2>
          <p className="max-w-prose text-md text-neutral-700">
            Nombres que los usuarios registraron sin encontrarlos en el
            catálogo, agrupados por nombre (sin contar tildes ni mayúsculas) y
            género. Resolver un grupo cambia todas sus plantas a la vez; sus
            dueños lo verán la próxima vez que se actualice su inventario. No se
            muestra quién las registró.
          </p>
        </div>

        {list.status === 'error' ? (
          <LoadError
            reason={list.reason}
            message={list.message}
            onRetry={list.retry}
          />
        ) : rows === null ? (
          <div aria-busy="true" className="flex flex-col gap-space-3">
            <p role="status" className="sr-only">
              Cargando las propuestas…
            </p>
            {Array.from({ length: SKELETON_GROUPS }, (_, index) => (
              <div
                key={index}
                aria-hidden="true"
                className="h-[136px] rounded-lg bg-neutral-50 motion-safe:animate-pulse"
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Notice icon="sprout">
            <p className="font-semibold">No hay propuestas por validar.</p>
            <p>
              Cuando alguien registre una planta con un nombre que no está en el
              catálogo, aparecerá aquí.
            </p>
          </Notice>
        ) : (
          <>
            <p className="text-sm text-neutral-700" aria-live="polite">
              {proposalGroupCountText(total)} por validar
              {refreshing ? ' · actualizando…' : ''}
            </p>
            <ul className="flex flex-col gap-space-3" aria-busy={refreshing}>
              {rows.map((group) => (
                <ProposalCard
                  key={proposalGroupId(group)}
                  group={group}
                  onAction={(kind) => setAction({ kind, group })}
                  onPhoto={(index) =>
                    setAction({ kind: 'photo', group, index })
                  }
                />
              ))}
            </ul>
            {pageCount > 1 && (
              <Pagination
                label="Páginas de propuestas"
                page={state.page}
                pageCount={pageCount}
                hasPrevious={state.page > 1}
                hasNext={state.page < pageCount}
                onFirst={() => onChange({ ...state, page: 1 })}
                onPrevious={() => onChange({ ...state, page: state.page - 1 })}
                onNext={() => onChange({ ...state, page: state.page + 1 })}
                onLast={() => onChange({ ...state, page: pageCount })}
              />
            )}
          </>
        )}

        {action?.kind === 'photo' && (
          <PhotoDialog
            group={action.group}
            index={action.index}
            onIndexChange={(index) => setAction({ ...action, index })}
            onClose={() => setAction(null)}
          />
        )}
        {action?.kind === 'link' && (
          <LinkDialog
            group={action.group}
            source={source}
            onCancel={() => setAction(null)}
            returnFocusTo={() => headingRef.current}
            onLinked={(result, speciesName) =>
              resolved(
                action.group,
                result,
                (plants) =>
                  `Se enlazaron ${plants} de «${action.group.proposedName}» a ${speciesName}.`,
              )
            }
          />
        )}
        {action?.kind === 'create' && (
          <CreateDialog
            group={action.group}
            source={source}
            onCancel={() => setAction(null)}
            returnFocusTo={() => headingRef.current}
            onCreated={(result, speciesName) =>
              resolved(
                action.group,
                result,
                (plants) =>
                  `Se dio de alta ${speciesName} y se le enlazaron ${plants} de «${action.group.proposedName}».`,
              )
            }
          />
        )}
        {action?.kind === 'unidentifiable' && (
          <UnidentifiableDialog
            group={action.group}
            source={source}
            onCancel={() => setAction(null)}
            returnFocusTo={() => headingRef.current}
            onMarked={(result) =>
              resolved(
                action.group,
                result,
                (plants) =>
                  `«${action.group.proposedName}» quedó como no identificable: ${plants} salen de la cola y siguen en el inventario de sus dueños.`,
              )
            }
          />
        )}
      </section>
    </PlantImagesContext>
  )
}

// Un grupo ------------------------------------------------------------------------

function ProposalCard({
  group,
  onAction,
  onPhoto,
}: {
  group: ProposalGroup
  onAction: (kind: 'link' | 'create' | 'unidentifiable') => void
  onPhoto: (index: number) => void
}) {
  return (
    <li className="flex flex-col gap-space-3 rounded-lg border-2 border-neutral-50 p-space-4">
      <div className="flex flex-col gap-space-1">
        <h3 className="text-lg font-semibold text-neutral-900 [overflow-wrap:anywhere]">
          «{group.proposedName}»
        </h3>
        <p className="text-sm text-neutral-700">
          {group.genusName} · {PLANT_TYPE_LABEL[group.type]} ·{' '}
          {proposalPlantCountText(group.plantCount)}
        </p>
      </div>

      {group.photos.length > 0 ? (
        <ul
          aria-label={`Fotos de «${group.proposedName}»`}
          className="flex flex-wrap gap-space-2"
        >
          {group.photos.map((photo, index) => (
            <li key={index}>
              <Thumbnail
                photo={photo}
                label={`Ampliar la foto ${index + 1} de ${group.photos.length} de «${group.proposedName}»`}
                onOpen={() => onPhoto(index)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-700">Sin fotos.</p>
      )}

      <div className="flex flex-wrap gap-space-2">
        <Button onClick={() => onAction('link')}>
          Enlazar a una especie
          <span className="sr-only"> «{group.proposedName}»</span>
        </Button>
        <Button onClick={() => onAction('create')}>
          Crear la especie
          <span className="sr-only"> «{group.proposedName}»</span>
        </Button>
        <Button onClick={() => onAction('unidentifiable')}>
          No identificable
          <span className="sr-only"> «{group.proposedName}»</span>
        </Button>
      </div>
    </li>
  )
}

function Thumbnail({
  photo,
  label,
  onOpen,
}: {
  photo: ProposalPhoto
  label: string
  onOpen: () => void
}) {
  const image = usePlantImage(photo.thumbnailPath, 'thumbnail')
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onOpen}
      className="flex size-[88px] cursor-pointer items-center justify-center overflow-hidden rounded-md bg-neutral-50"
    >
      {image.status === 'ready' ? (
        <img src={image.src} alt="" className="size-full object-cover" />
      ) : (
        <Icon
          name={image.status === 'error' ? 'triangle-alert' : 'image'}
          className="size-[24px] text-neutral-700"
        />
      )}
    </button>
  )
}

// Foto ampliada --------------------------------------------------------------------

function PhotoDialog({
  group,
  index,
  onIndexChange,
  onClose,
}: {
  group: ProposalGroup
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const photo = group.photos[index]
  const image = usePlantImage(photo?.photoPath ?? null, 'photo')
  const count = group.photos.length
  const alt = `Foto ${index + 1} de ${count} de «${group.proposedName}»`
  return (
    <ModalDialog
      title={`Fotos de «${group.proposedName}»`}
      initialFocus={() => closeRef.current?.focus()}
      onCancel={onClose}
      widthClassName="max-w-[720px]"
    >
      <div className="flex min-h-[240px] items-center justify-center rounded-md bg-neutral-50">
        {image.status === 'ready' ? (
          <img
            src={image.src}
            alt={alt}
            className="max-h-[70vh] w-full rounded-md object-contain"
          />
        ) : (
          <p role="status" className="p-space-4 text-md text-neutral-900">
            {image.status === 'error'
              ? 'No se pudo cargar la foto.'
              : 'Cargando la foto…'}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-space-3">
        <p className="text-sm text-neutral-700">
          {index + 1} de {count}
        </p>
        <div className="flex flex-wrap gap-space-2">
          {count > 1 && (
            <>
              <Button
                aria-disabled={index === 0}
                onClick={() => {
                  if (index > 0) onIndexChange(index - 1)
                }}
              >
                Anterior
              </Button>
              <Button
                aria-disabled={index === count - 1}
                onClick={() => {
                  if (index < count - 1) onIndexChange(index + 1)
                }}
              >
                Siguiente
              </Button>
            </>
          )}
          <Button ref={closeRef} onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </ModalDialog>
  )
}

// Resumen del grupo dentro de un diálogo ----------------------------------------

function GroupSummary({ group, id }: { group: ProposalGroup; id?: string }) {
  return (
    <p id={id} className="text-md text-neutral-900">
      «{group.proposedName}» · {group.genusName} ·{' '}
      {PLANT_TYPE_LABEL[group.type]} ·{' '}
      {proposalPlantCountText(group.plantCount)}
    </p>
  )
}

function DialogError({ message }: { message: string | null }) {
  if (message === null) return null
  return (
    <p
      role="alert"
      className="flex items-start gap-space-2 font-semibold text-danger"
    >
      <Icon
        name="triangle-alert"
        className="mt-space-1 size-[16px] flex-none"
      />
      {message}
    </p>
  )
}

// Enlazar a una especie existente -------------------------------------------------

const SEARCH_RESULTS = 10

function LinkDialog({
  group,
  source,
  onCancel,
  onLinked,
  returnFocusTo,
}: {
  group: ProposalGroup
  source: CatalogAdminSource
  onCancel: () => void
  onLinked: (result: ProposalResolution, speciesName: string) => void
  returnFocusTo: () => HTMLElement | null
}) {
  const baseId = useId()
  const searchId = `${baseId}-buscar`
  const confirmId = `${baseId}-enlazar`
  const introId = `${baseId}-intro`
  const [text, setText] = useState(group.proposedName)
  const [picked, setPicked] = useState<CatalogSpeciesRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Al elegir o al volver al buscador, el foco pasa al control nuevo.
  const focusAfter = useRef<string | null>(null)
  useEffect(() => {
    const id = focusAfter.current
    if (id === null) return
    focusAfter.current = null
    document.getElementById(id)?.focus()
  }, [picked])

  const query = picked === null ? prepareSearchQuery(text) : null
  const search = useRemoteData(
    query,
    (signal) =>
      source.searchSpecies(query ?? '', { pageSize: SEARCH_RESULTS, signal }),
    { debounceMs: SEARCH_DEBOUNCE_MS },
  )
  const results = search.status === 'success' ? search.data.rows : []

  const link = async () => {
    if (picked === null || saving) return
    setSaving(true)
    setError(null)
    try {
      const result = await source.linkProposal(group, picked.id)
      onLinked(result, picked.scientificName)
    } catch (caught) {
      const failure = toCatalogWriteError(caught)
      setSaving(false)
      if (failure.problem === 'species-not-found') {
        focusAfter.current = searchId
        setPicked(null)
        setError(
          'Esa especie ya no está en el catálogo: puede que otra persona la haya fusionado o borrado. Elige otra.',
        )
      } else {
        setError(failure.message)
      }
    }
  }

  return (
    <ModalDialog
      title="Enlazar a una especie del catálogo"
      describedBy={introId}
      busy={saving}
      initialFocus={() => document.getElementById(searchId)?.focus()}
      onCancel={onCancel}
      returnFocusTo={returnFocusTo}
      widthClassName="max-w-[640px]"
    >
      <div id={introId} className="flex flex-col gap-space-2">
        <GroupSummary group={group} />
        <p className="text-md text-neutral-700">
          Las plantas tomarán el género y el tipo de la especie elegida y
          quedarán validadas. El nombre que escribió cada usuario se conserva.
        </p>
      </div>

      {picked === null ? (
        <Autocomplete
          id={searchId}
          label="Especie"
          value={text}
          onValueChange={setText}
          options={results.map((row) => ({
            id: row.id,
            label: row.scientificName,
            secondary: `${row.genusName} · ${TYPE_LABEL[row.type]} · ${STATUS_LABEL[row.status]}`,
          }))}
          onOptionSelect={(option) => {
            const row = results.find((item) => item.id === option.id)
            if (!row) return
            focusAfter.current = confirmId
            setError(null)
            setPicked(row)
          }}
          labelStyle="scientific"
          renderLabel={(option) => <ScientificName name={option.label} />}
          loading={search.status === 'loading'}
          error={search.status === 'error' ? search.message : undefined}
          minQueryLength={2}
          placeholder="Nombre científico, sinónimo o nombre común"
          emptyText="Ninguna especie coincide: prueba con otra parte del nombre o crea la especie"
          hint="Empieza con el nombre propuesto; corrígelo si hace falta."
        />
      ) : (
        <div className="orki-field">
          <span id={`${baseId}-elegida`} className="orki-field__label">
            Especie
          </span>
          <div
            role="group"
            aria-labelledby={`${baseId}-elegida`}
            className="flex flex-wrap items-center gap-space-3"
          >
            <span className="text-md text-neutral-900 [overflow-wrap:anywhere]">
              <span className="scientific-name font-semibold">
                <ScientificName name={picked.scientificName} />
              </span>{' '}
              <span className="text-sm text-neutral-700">
                ({picked.genusName} · {TYPE_LABEL[picked.type]} ·{' '}
                {STATUS_LABEL[picked.status]})
              </span>
            </span>
            <Button
              aria-disabled={saving}
              onClick={() => {
                if (saving) return
                focusAfter.current = searchId
                setPicked(null)
              }}
            >
              Cambiar <span className="sr-only">la especie</span>
            </Button>
          </div>
          {picked.genusId !== group.genusId && (
            <p className="text-sm text-neutral-700">
              Aviso: la propuesta es de {group.genusName} y la especie, de{' '}
              {picked.genusName}. Las plantas pasarán a {picked.genusName}.
            </p>
          )}
        </div>
      )}

      <DialogError message={error} />
      <p role="status" className="sr-only">
        {saving ? 'Enlazando…' : ''}
      </p>
      <div className="flex flex-wrap justify-end gap-space-3">
        <Button
          aria-disabled={saving}
          onClick={() => {
            if (!saving) onCancel()
          }}
        >
          Cancelar
        </Button>
        <Button
          id={confirmId}
          variant="primary"
          aria-disabled={picked === null || saving}
          onClick={() => void link()}
        >
          {saving
            ? 'Enlazando…'
            : `Enlazar ${proposalPlantCountText(group.plantCount)}`}
        </Button>
      </div>
    </ModalDialog>
  )
}

// Crear la especie ------------------------------------------------------------------

/** Tipo inicial de la especie nueva: el del grupo, o "especie" si no se sabe. */
function initialSpeciesType(group: ProposalGroup): SpeciesType {
  return group.type === 'hybrid' ? 'hybrid' : 'species'
}

function CreateDialog({
  group,
  source,
  onCancel,
  onCreated,
  returnFocusTo,
}: {
  group: ProposalGroup
  source: CatalogAdminSource
  onCancel: () => void
  onCreated: (result: ProposalResolution, speciesName: string) => void
  returnFocusTo: () => HTMLElement | null
}) {
  const nameId = useId()
  const introId = useId()
  return (
    <ModalDialog
      title="Crear la especie desde la propuesta"
      describedBy={introId}
      initialFocus={() => document.getElementById(nameId)?.focus()}
      onCancel={onCancel}
      returnFocusTo={returnFocusTo}
      widthClassName="max-w-[640px]"
    >
      <GroupSummary group={group} id={introId} />
      <SpeciesForm
        source={source}
        nameInputId={nameId}
        onCancel={onCancel}
        proposal={{
          scientificName: group.proposedName,
          genus: { id: group.genusId, name: group.genusName },
          type: initialSpeciesType(group),
          plantCount: group.plantCount,
          save: async (input) => {
            const result = await source.createSpeciesFromProposal(group, input)
            onCreated(result, input.scientificName.trim().replace(/\s+/g, ' '))
          },
        }}
      />
    </ModalDialog>
  )
}

// No identificable --------------------------------------------------------------

function UnidentifiableDialog({
  group,
  source,
  onCancel,
  onMarked,
  returnFocusTo,
}: {
  group: ProposalGroup
  source: CatalogAdminSource
  onCancel: () => void
  onMarked: (result: ProposalResolution) => void
  returnFocusTo: () => HTMLElement | null
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mark = async () => {
    setSaving(true)
    setError(null)
    try {
      onMarked(await source.markProposalUnidentifiable(group))
    } catch (caught) {
      setSaving(false)
      setError(toCatalogWriteError(caught).message)
    }
  }
  return (
    <ConfirmDialog
      title="Marcar como no identificable"
      confirmLabel={`Marcar ${proposalPlantCountText(group.plantCount)}`}
      variant="danger"
      busy={saving}
      error={error}
      onConfirm={() => void mark()}
      onCancel={onCancel}
      returnFocusTo={returnFocusTo}
    >
      <GroupSummary group={group} />
      <p>
        {group.plantCount === 1
          ? 'La planta sale de la cola sin especie y sigue en la colección de su dueño, que la verá como «No identificable».'
          : `Las ${formatCount(group.plantCount)} plantas salen de la cola sin especie y siguen en la colección de sus dueños, que las verán como «No identificables».`}{' '}
        Desde aquí no se puede deshacer.
      </p>
    </ConfirmDialog>
  )
}
