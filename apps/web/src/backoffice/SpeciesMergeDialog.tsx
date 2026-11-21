import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Autocomplete } from '../components/ui/Autocomplete.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import type {
  CatalogSpeciesDetail,
  CatalogSpeciesRow,
} from '../lib/catalogAdmin.ts'
import { prepareSearchQuery, speciesMatchText } from '../lib/catalogSearch.ts'
import {
  CatalogWriteError,
  toCatalogWriteError,
  type MergeName,
  type SkippedMergeName,
  type SpeciesMergePreview,
  type SpeciesMergeResult,
} from '../lib/catalogWrites.ts'
import { PATHS, signInPathFor } from '../routes/paths.ts'
import { ModalDialog } from './ModalDialog.tsx'
import { LoadError } from './parts.tsx'
import type { CatalogAdminSource } from './source.ts'
import { formatCount, SOURCE_LABEL, STATUS_LABEL, TYPE_LABEL } from './texts.ts'
import {
  SEARCH_DEBOUNCE_MS,
  useRemoteData,
  type RemoteData,
} from './useRemoteData.ts'

// Fusión de una especie con otra (#136, parte de #21), en un diálogo modal que
// se abre desde el detalle de la especie:
//
// 1. La otra especie se elige con el buscador del catálogo del backoffice
//    (searchSpecies, el de la tabla); la del detalle no se ofrece.
// 2. Se elige explícitamente cuál se conserva (no hay ninguna marcada al
//    principio); la otra se absorbe. "Intercambiar" da la vuelta a la
//    elección.
// 3. Con las dos y la elección, se pide la vista previa a la base
//    (previewMerge); cada cambio de especie o de elección la vuelve a pedir y,
//    mientras llega, no se muestra la anterior. Dice cuántas plantas se mueven,
//    qué nombres pasan, cuáles ya existían y por qué, si cambian el género o
//    el tipo de las plantas y si la conservada pasará a "validada".
// 4. "Fusionar" solo responde con la vista previa de esas dos especies, en ese
//    orden, cargada y sin rechazos; junto al botón se dice que no se puede
//    deshacer. Tras fusionar, la pantalla abre la conservada y lo anuncia.
//
// Si una de las dos ya no existe (otra persona la fusionó o la borró), se
// explica y se ofrece salir: elegir otra especie o, si la que falta es la del
// detalle, cerrar y volver a leer el catálogo.

export interface SpeciesMergeDialogProps {
  /** La especie del detalle desde el que se abre. */
  species: CatalogSpeciesDetail
  source: CatalogAdminSource
  onCancel: () => void
  /** Se fusionaron: la pantalla abre la conservada y anuncia el mensaje. */
  onMerged: (keptId: string, message: string) => void
  /** La especie del detalle ya no existe: la pantalla cierra y vuelve a leer. */
  onSpeciesGone: (message: string) => void
  /** Ver ModalDialog. */
  returnFocusTo?: () => HTMLElement | null
}

/** La otra especie, tal como llegó del buscador. */
interface PickedSpecies {
  id: string
  scientificName: string
  genusName: string
  type: CatalogSpeciesRow['type']
  status: CatalogSpeciesRow['status']
}

/** Cuál se conserva: la del detalle o la otra. */
type Keep = 'this' | 'other'

/** La vista previa o el rechazo de la base (una especie que falta). */
type PreviewOutcome =
  | { ok: true; preview: SpeciesMergePreview }
  | { ok: false; error: CatalogWriteError }

const RADIO = 'mt-space-1 size-[24px] flex-none cursor-pointer accent-secondary'
const SEARCH_RESULTS = 10

export function SpeciesMergeDialog({
  species,
  source,
  onCancel,
  onMerged,
  onSpeciesGone,
  returnFocusTo,
}: SpeciesMergeDialogProps) {
  const baseId = useId()
  const introId = `${baseId}-intro`
  const searchId = `${baseId}-buscar`
  const radioName = `${baseId}-conservar`
  const firstRadioId = `${baseId}-conservar-esta`
  const confirmHintId = `${baseId}-confirmar`
  const roleHintId = `${baseId}-papeles`

  const [text, setText] = useState('')
  const [other, setOther] = useState<PickedSpecies | null>(null)
  const [keep, setKeep] = useState<Keep | null>(null)
  const [merging, setMerging] = useState(false)
  const [mergeError, setMergeError] = useState<CatalogWriteError | null>(null)
  // Rechazo de la fusión (una especie que falta) para un par concreto.
  const [rejection, setRejection] = useState<{
    key: string
    error: CatalogWriteError
  } | null>(null)

  // Al elegir la otra especie o al volver al buscador, el foco pasa al
  // control nuevo en cuanto se pinta.
  const focusAfter = useRef<string | null>(null)
  useEffect(() => {
    const id = focusAfter.current
    if (id === null) return
    focusAfter.current = null
    document.getElementById(id)?.focus()
  }, [other])

  // Buscador: el del catálogo del backoffice, sin la especie del detalle.
  const query = other === null ? prepareSearchQuery(text) : null
  const search = useRemoteData(
    query,
    (signal) =>
      source.searchSpecies(query ?? '', { pageSize: SEARCH_RESULTS, signal }),
    { debounceMs: SEARCH_DEBOUNCE_MS },
  )
  const results =
    search.status === 'success'
      ? search.data.rows.filter((row) => row.id !== species.id)
      : []

  // La pareja: la que se absorbe (merged) y la que se conserva (kept).
  const pair =
    other === null || keep === null
      ? null
      : keep === 'this'
        ? {
            merged: { id: other.id, name: other.scientificName },
            kept: { id: species.id, name: species.scientificName },
          }
        : {
            merged: { id: species.id, name: species.scientificName },
            kept: { id: other.id, name: other.scientificName },
          }
  const pairKey = pair ? `${pair.merged.id}>${pair.kept.id}` : null

  const preview = useRemoteData<PreviewOutcome>(pairKey, async (signal) => {
    try {
      const data = await source.previewMerge(
        pair?.merged.id ?? '',
        pair?.kept.id ?? '',
        { signal },
      )
      return { ok: true, preview: data }
    } catch (error) {
      // Los rechazos de la fusión se explican aparte; lo demás (sin
      // conexión, sesión, permiso) lo clasifica useRemoteData.
      if (error instanceof CatalogWriteError) return { ok: false, error }
      throw error
    }
  })

  const outcome = preview.status === 'success' ? preview.data : null
  const rejected =
    outcome?.ok === false
      ? outcome.error
      : rejection !== null && rejection.key === pairKey
        ? rejection.error
        : null
  const shown =
    outcome?.ok === true && rejected === null ? outcome.preview : null
  const ready = pair !== null && shown !== null

  const chooseOther = (row: CatalogSpeciesRow) => {
    focusAfter.current = firstRadioId
    setOther({
      id: row.id,
      scientificName: row.scientificName,
      genusName: row.genusName,
      type: row.type,
      status: row.status,
    })
    setKeep(null)
    setMergeError(null)
  }
  const resetOther = () => {
    focusAfter.current = searchId
    setOther(null)
    setKeep(null)
    setText('')
    setMergeError(null)
    setRejection(null)
  }

  const merge = async () => {
    if (!ready || merging) return
    setMerging(true)
    setMergeError(null)
    try {
      const result = await source.mergeSpecies(pair.merged.id, pair.kept.id)
      onMerged(pair.kept.id, mergedMessage(shown, result))
    } catch (caught) {
      const error = toCatalogWriteError(caught)
      setMerging(false)
      if (
        error.problem === 'species-not-found' ||
        error.problem === 'same-species'
      ) {
        setRejection({ key: `${pair.merged.id}>${pair.kept.id}`, error })
      } else {
        setMergeError(error)
      }
    }
  }

  const statusText = merging
    ? 'Fusionando…'
    : pair === null
      ? ''
      : preview.status === 'loading'
        ? 'Cargando la vista previa…'
        : shown
          ? `Vista previa lista. ${plantsWillMoveText(shown.plantCount)} ${namesWillMoveText(shown.movedNames.length)}`
          : ''

  return (
    <ModalDialog
      title={
        <>
          Fusionar{' '}
          <span className="scientific-name">
            <ScientificName name={species.scientificName} />
          </span>{' '}
          con otra especie
        </>
      }
      describedBy={introId}
      busy={merging}
      initialFocus={() => document.getElementById(searchId)?.focus()}
      onCancel={onCancel}
      returnFocusTo={returnFocusTo}
      widthClassName="max-w-[640px]"
    >
      <p id={introId} className="text-md text-neutral-900">
        Para quitar un duplicado: la especie que se absorbe pasa sus plantas y
        sus nombres a la que se conserva y desaparece del catálogo. Antes de
        confirmar verás qué va a cambiar.
      </p>

      {other === null ? (
        <Autocomplete
          id={searchId}
          label="Otra especie"
          value={text}
          onValueChange={setText}
          options={results.map((row) => ({
            id: row.id,
            label: row.scientificName,
            secondary: optionDetails(row),
          }))}
          onOptionSelect={(option) => {
            const row = results.find((item) => item.id === option.id)
            if (row) chooseOther(row)
          }}
          labelStyle="scientific"
          renderLabel={(option) => <ScientificName name={option.label} />}
          loading={search.status === 'loading'}
          error={search.status === 'error' ? search.message : undefined}
          minQueryLength={2}
          placeholder="Nombre científico, sinónimo o nombre común"
          emptyText="Ninguna otra especie coincide"
          hint="La que buscas aquí y la de este detalle: luego eliges cuál se conserva."
        />
      ) : (
        <div className="flex flex-col gap-space-4">
          <div className="orki-field">
            <span id={`${baseId}-otra`} className="orki-field__label">
              Otra especie
            </span>
            <div
              role="group"
              aria-labelledby={`${baseId}-otra`}
              className="flex flex-wrap items-center gap-space-3"
            >
              <span className="text-md text-neutral-900 [overflow-wrap:anywhere]">
                <span className="scientific-name font-semibold">
                  <ScientificName name={other.scientificName} />
                </span>{' '}
                <span className="text-sm text-neutral-700">
                  ({other.genusName} · {TYPE_LABEL[other.type]} ·{' '}
                  {STATUS_LABEL[other.status]})
                </span>
              </span>
              <Button
                aria-disabled={merging}
                onClick={() => {
                  if (!merging) resetOther()
                }}
              >
                Cambiar <span className="sr-only">la otra especie</span>
              </Button>
            </div>
          </div>

          <fieldset
            className="flex flex-col gap-space-2"
            aria-describedby={roleHintId}
            disabled={merging}
          >
            <legend className="orki-field__label mb-space-2">
              ¿Cuál se conserva?
            </legend>
            <KeepOption
              id={firstRadioId}
              name={radioName}
              checked={keep === 'this'}
              onChange={() => setKeep('this')}
              scientificName={species.scientificName}
              note="la de este detalle"
            />
            <KeepOption
              id={`${baseId}-conservar-otra`}
              name={radioName}
              checked={keep === 'other'}
              onChange={() => setKeep('other')}
              scientificName={other.scientificName}
              note="la que elegiste"
            />
          </fieldset>
          <div className="flex flex-wrap items-center gap-space-3">
            <p id={roleHintId} className="text-sm text-neutral-700">
              {pair === null ? (
                'Elige cuál se conserva: la otra se absorbe y desaparece del catálogo.'
              ) : (
                <>
                  Se conserva <Name name={pair.kept.name} />. Se absorbe{' '}
                  <Name name={pair.merged.name} />.
                </>
              )}
            </p>
            {pair !== null && (
              <Button
                aria-disabled={merging}
                onClick={() => {
                  if (merging) return
                  setKeep((value) => (value === 'this' ? 'other' : 'this'))
                  setMergeError(null)
                }}
              >
                Intercambiar <span className="sr-only">cuál se conserva</span>
              </Button>
            )}
          </div>

          {pair !== null && (
            <PreviewSection
              preview={preview}
              shown={shown}
              rejected={rejected}
              pair={pair}
              thisSpeciesId={species.id}
              onChooseOther={resetOther}
              onSpeciesGone={onSpeciesGone}
            />
          )}
        </div>
      )}

      {mergeError && (
        <div
          role="alert"
          className="flex flex-col items-start gap-space-2 font-semibold text-danger"
        >
          <p className="flex items-start gap-space-2">
            <Icon
              name="triangle-alert"
              className="mt-space-1 size-[16px] flex-none"
            />
            {mergeError.message}
          </p>
          {mergeError.problem === 'session-ended' && (
            <Link
              to={signInPathFor(PATHS.catalogAdmin)}
              className="orki-btn orki-btn--secondary"
            >
              Iniciar sesión
            </Link>
          )}
        </div>
      )}

      <p role="status" className="sr-only">
        {statusText}
      </p>

      <div className="flex flex-col gap-space-3 border-t-2 border-neutral-50 pt-space-4">
        <p
          id={confirmHintId}
          className={
            ready
              ? 'font-semibold text-neutral-900'
              : 'text-sm text-neutral-700'
          }
        >
          {ready ? (
            <>
              La fusión no se puede deshacer: <Name name={pair.merged.name} />{' '}
              desaparecerá del catálogo.
            </>
          ) : (
            'Para fusionar, elige la otra especie y cuál se conserva, y espera a la vista previa.'
          )}
        </p>
        <div className="flex flex-wrap justify-end gap-space-3">
          <Button
            aria-disabled={merging}
            onClick={() => {
              if (!merging) onCancel()
            }}
          >
            Cancelar
          </Button>
          <Button
            variant="danger"
            aria-disabled={!ready || merging}
            aria-describedby={confirmHintId}
            onClick={() => void merge()}
          >
            {merging ? 'Fusionando…' : 'Fusionar'}
            {ready && !merging && (
              <>
                {' '}
                <span className="sr-only">
                  {pair.merged.name} en {pair.kept.name}
                </span>
              </>
            )}
          </Button>
        </div>
      </div>
    </ModalDialog>
  )
}

function KeepOption({
  id,
  name,
  checked,
  onChange,
  scientificName,
  note,
}: {
  id: string
  name: string
  checked: boolean
  onChange: () => void
  scientificName: string
  note: string
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-space-3 rounded-md p-space-2 hover:bg-neutral-50"
    >
      <input
        id={id}
        type="radio"
        name={name}
        className={RADIO}
        checked={checked}
        onChange={onChange}
      />
      <span className="text-md text-neutral-900 [overflow-wrap:anywhere]">
        Conservar <Name name={scientificName} />{' '}
        <span className="text-sm text-neutral-700">({note})</span>
      </span>
    </label>
  )
}

/** Un nombre científico entre comillas angulares, con su estilo. */
function Name({ name }: { name: string }) {
  return (
    <>
      «
      <span className="scientific-name">
        <ScientificName name={name} />
      </span>
      »
    </>
  )
}

function optionDetails(row: CatalogSpeciesRow): string {
  const match =
    row.matchedName !== undefined && row.matchedNameType
      ? speciesMatchText({
          matchedName: row.matchedName,
          matchedNameType: row.matchedNameType,
        })
      : undefined
  return [row.genusName, TYPE_LABEL[row.type], STATUS_LABEL[row.status], match]
    .filter(Boolean)
    .join(' · ')
}

// Vista previa ------------------------------------------------------------------

function PreviewSection({
  preview,
  shown,
  rejected,
  pair,
  thisSpeciesId,
  onChooseOther,
  onSpeciesGone,
}: {
  preview: RemoteData<PreviewOutcome> & { retry: () => void }
  shown: SpeciesMergePreview | null
  rejected: CatalogWriteError | null
  pair: {
    merged: { id: string; name: string }
    kept: { id: string; name: string }
  }
  thisSpeciesId: string
  onChooseOther: () => void
  onSpeciesGone: (message: string) => void
}) {
  const headingId = useId()
  let body: ReactNode
  if (rejected !== null) {
    body = (
      <Rejection
        error={rejected}
        pair={pair}
        thisSpeciesId={thisSpeciesId}
        onChooseOther={onChooseOther}
        onSpeciesGone={onSpeciesGone}
      />
    )
  } else if (preview.status === 'error') {
    body = (
      <LoadError
        compact
        reason={preview.reason}
        message={preview.message}
        onRetry={preview.retry}
      />
    )
  } else if (shown === null) {
    body = (
      <div aria-hidden="true" className="flex flex-col gap-space-2">
        {['w-3/4', 'w-1/2', 'w-full'].map((width, index) => (
          <div
            key={index}
            className={`h-space-4 rounded-sm bg-neutral-0 motion-safe:animate-pulse ${width}`}
          />
        ))}
      </div>
    )
  } else {
    body = <PreviewDetails preview={shown} />
  }
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={preview.status === 'loading'}
      className="flex flex-col gap-space-3 rounded-lg bg-neutral-50 p-space-4"
    >
      <h3 id={headingId} className="text-md font-semibold text-neutral-900">
        Vista previa
      </h3>
      {body}
    </section>
  )
}

function Rejection({
  error,
  pair,
  thisSpeciesId,
  onChooseOther,
  onSpeciesGone,
}: {
  error: CatalogWriteError
  pair: {
    merged: { id: string; name: string }
    kept: { id: string; name: string }
  }
  thisSpeciesId: string
  onChooseOther: () => void
  onSpeciesGone: (message: string) => void
}) {
  const role = error.details.speciesRole
  const missing =
    error.problem !== 'species-not-found'
      ? null
      : role === 'kept'
        ? pair.kept
        : role === 'merged'
          ? pair.merged
          : null
  const goneText = (name: string) =>
    `«${name}» ya no está en el catálogo: puede que otra persona la haya fusionado o borrado. No se cambió nada.`
  const message = missing ? goneText(missing.name) : error.message
  const thisIsGone =
    error.problem === 'species-not-found' &&
    (missing === null || missing.id === thisSpeciesId)
  return (
    <div role="alert" className="flex flex-col items-start gap-space-3">
      <p className="flex items-start gap-space-2 font-semibold text-neutral-900">
        <Icon
          name="triangle-alert"
          className="mt-space-1 size-[16px] flex-none"
        />
        {message}
      </p>
      {thisIsGone ? (
        <Button
          onClick={() =>
            onSpeciesGone(
              missing
                ? goneText(missing.name)
                : 'Una de las especies ya no está en el catálogo: puede que otra persona la haya fusionado o borrado.',
            )
          }
        >
          Cerrar y volver a leer el catálogo
        </Button>
      ) : (
        <Button onClick={onChooseOther}>Elegir otra especie</Button>
      )}
    </div>
  )
}

const FACT = 'flex items-start gap-space-2 text-md text-neutral-900'

function PreviewDetails({ preview }: { preview: SpeciesMergePreview }) {
  const { merged, kept } = preview
  return (
    <div className="flex flex-col gap-space-3">
      <ul className="flex flex-col gap-space-2">
        <li className={FACT}>
          <span>
            {preview.plantCount === 0 ? (
              <>
                Ninguna planta de usuarios tiene enlazada{' '}
                <Name name={merged.scientificName} />.
              </>
            ) : (
              <>
                {preview.plantCount === 1
                  ? 'Se moverá 1 planta de usuarios'
                  : `Se moverán ${formatCount(preview.plantCount)} plantas de usuarios`}{' '}
                de <Name name={merged.scientificName} /> a{' '}
                <Name name={kept.scientificName} />. Tomarán su género y su
                tipo; el nombre que escribió cada usuario no cambia.
              </>
            )}
          </span>
        </li>
        {preview.genusDiffers && (
          <Warning>
            Cambia el género: las plantas de{' '}
            <Name name={merged.scientificName} /> pasarán de {merged.genusName}{' '}
            a {kept.genusName}.
          </Warning>
        )}
        {preview.typeDiffers && (
          <Warning>
            Cambia el tipo: las plantas pasarán de «
            {TYPE_LABEL[merged.type].toLowerCase()}» a «
            {TYPE_LABEL[kept.type].toLowerCase()}».
          </Warning>
        )}
        {preview.keptBecomesValidated && (
          <li className={FACT}>
            <span>
              <Name name={kept.scientificName} /> pasará de «
              {STATUS_LABEL.imported}» a «{STATUS_LABEL.validated}», para que la
              importación del <span lang="en">Catalogue of Life</span> no
              deshaga la fusión.
            </span>
          </li>
        )}
        {preview.rememberedKeys.length > 0 && (
          <li className={FACT}>
            <span>
              La importación no volverá a crear{' '}
              <Name name={merged.scientificName} />: la memoria de las fusiones
              asociará a <Name name={kept.scientificName} />{' '}
              {preview.rememberedKeys.length === 1
                ? 'su referencia'
                : `sus ${formatCount(preview.rememberedKeys.length)} referencias`}{' '}
              (
              {preview.rememberedKeys
                .map(
                  (key) =>
                    `${SOURCE_LABEL[key.source]} ${key.sourceRef}${key.inherited ? ', heredada de una fusión anterior' : ''}`,
                )
                .join('; ')}
              ).
            </span>
          </li>
        )}
      </ul>

      <NameList
        title={
          <>
            Nombres que pasan a <Name name={kept.scientificName} /> (
            {formatCount(preview.movedNames.length)})
          </>
        }
        empty="Ninguno: la conservada ya tiene todos."
        items={preview.movedNames.map((name) => ({
          name,
          description: movedNameText(name),
        }))}
      />
      {preview.existingNames.length > 0 && (
        <NameList
          title={
            <>
              Nombres que ya existían y no pasan (
              {formatCount(preview.existingNames.length)})
            </>
          }
          empty=""
          items={preview.existingNames.map((name) => ({
            name,
            description: existingNameText(name, kept.scientificName),
          }))}
        />
      )}
    </div>
  )
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-space-2 rounded-md bg-neutral-0 p-space-2 text-md font-semibold text-neutral-900">
      <Icon
        name="triangle-alert"
        className="mt-space-1 size-[16px] flex-none text-danger"
      />
      <span>
        <span className="sr-only">Atención: </span>
        {children}
      </span>
    </li>
  )
}

function NameList({
  title,
  empty,
  items,
}: {
  title: ReactNode
  empty: string
  items: { name: MergeName; description: string }[]
}) {
  const headingId = useId()
  return (
    <div className="flex flex-col gap-space-1">
      <h4 id={headingId} className="text-sm font-semibold text-neutral-900">
        {title}
      </h4>
      {items.length === 0 ? (
        <p className="text-sm text-neutral-700">{empty}</p>
      ) : (
        <ul aria-labelledby={headingId} className="flex flex-col gap-space-1">
          {items.map(({ name, description }, index) => (
            <li
              key={index}
              className="text-sm text-neutral-900 [overflow-wrap:anywhere]"
            >
              {name.type === 'common' ? (
                <span lang={name.language ?? undefined}>{name.name}</span>
              ) : (
                <span className="scientific-name">
                  <ScientificName name={name.name} />
                </span>
              )}{' '}
              <span className="text-neutral-700">· {description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const ORIGIN_TEXT: Record<SkippedMergeName['existingType'], string> = {
  scientific_name: 'nombre científico',
  synonym: 'sinónimo',
  common: 'nombre común',
}

function movedNameText(name: MergeName): string {
  if (name.origin === 'scientific_name')
    return 'su nombre científico, que pasa como sinónimo'
  if (name.type === 'common')
    return name.language ? `nombre común (${name.language})` : 'nombre común'
  return 'sinónimo'
}

function existingNameText(name: SkippedMergeName, keptName: string): string {
  const what = ORIGIN_TEXT[name.existingType]
  if (name.reason === 'already_in_kept') {
    return name.existingType === 'scientific_name'
      ? `es el nombre científico de «${keptName}»`
      : `«${keptName}» ya lo tiene como ${what}: «${name.existingName}»`
  }
  return `se escribe igual que «${name.existingName}» (${what}), que sí pasa`
}

// Textos ------------------------------------------------------------------------

function plantsWillMoveText(count: number): string {
  if (count === 0) return 'No se mueve ninguna planta.'
  return count === 1
    ? 'Se moverá 1 planta.'
    : `Se moverán ${formatCount(count)} plantas.`
}

function namesWillMoveText(count: number): string {
  if (count === 0) return 'No pasa ningún nombre.'
  return count === 1
    ? 'Pasará 1 nombre.'
    : `Pasarán ${formatCount(count)} nombres.`
}

/** Lo que se anuncia tras fusionar. */
function mergedMessage(
  preview: SpeciesMergePreview,
  result: SpeciesMergeResult,
): string {
  const merged = `«${preview.merged.scientificName}»`
  const kept = `«${preview.kept.scientificName}»`
  const plants =
    result.plantCount === 0
      ? 'no había plantas que mover'
      : result.plantCount === 1
        ? 'se movió 1 planta'
        : `se movieron ${formatCount(result.plantCount)} plantas`
  const names =
    result.movedNameCount === 0
      ? 'no pasó ningún nombre'
      : result.movedNameCount === 1
        ? 'pasó 1 nombre'
        : `pasaron ${formatCount(result.movedNameCount)} nombres`
  const skipped =
    result.skippedNameCount === 0
      ? ''
      : result.skippedNameCount === 1
        ? ' (1 ya existía)'
        : ` (${formatCount(result.skippedNameCount)} ya existían)`
  const validated = result.keptValidated
    ? ` ${kept} pasó a «${STATUS_LABEL.validated}».`
    : ''
  return `Se fusionó ${merged} en ${kept}: ${plants} y ${names}${skipped}.${validated}`
}
