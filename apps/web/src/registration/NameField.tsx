import {
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type Ref,
} from 'react'
import {
  Autocomplete,
  type AutocompleteOption,
} from '../components/ui/Autocomplete.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { MatchBadge } from '../components/ui/MatchBadge.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import {
  SEARCH_QUERY_MIN_LENGTH,
  speciesMatchText,
  type CatalogSearchFunction,
  type SpeciesSearchResult,
} from '../lib/catalogSearch.ts'
import { useCatalogSearch } from '../lib/useCatalogSearch.ts'
import {
  isPendingName,
  normalizePlantName,
  PLANT_NAME_MAX_LENGTH,
  type PlantFormAction,
  type PlantFormValues,
} from './form-state.ts'
import { exactNameMatch, formSpeciesOf, type NameMatch } from './name-match.ts'
import { PLANT_FORM_TEXT } from './texts.ts'

/**
 * Si ya se sabe qué pasará con el nombre (#280):
 * - resolving: aún se está buscando (o a punto de enlazar la especie exacta);
 * - offer: hay especies del catálogo que coinciden enteras y esperan a que la
 *   persona elija (un sinónimo, varias);
 * - settled: enlazado, por validar o sin nombre que buscar.
 */
export type NameResolution = 'resolving' | 'offer' | 'settled'

interface NameFieldProps {
  values: PlantFormValues
  dispatch: Dispatch<PlantFormAction>
  searchSpecies: CatalogSearchFunction<SpeciesSearchResult>
  error?: string
  inputRef: Ref<HTMLInputElement>
  /**
   * Enlazar solo también el nombre con el que se montó el campo (#280): el de
   * ?nombre= o el de un borrador. Sin esto (la edición) solo se enlaza lo que
   * se escribe: abrir una planta por validar no la cambia sin tocarla.
   */
  linkInitialName?: boolean
  /** Avisa cuando cambia NameResolution; el registro espera a ella para guardar. */
  onResolutionChange?: (resolution: NameResolution) => void
  /**
   * Sin conexión (#296, el registro): no se busca en el catálogo, se dice, y
   * el nombre queda como texto. Al volver se busca solo y se aplica la regla
   * del nombre exacto, sin cambiar lo que la persona eligió mientras tanto.
   */
  offline?: boolean
}

const renderScientificName = (option: AutocompleteOption) => (
  <ScientificName name={option.label} />
)

/** Nombre aceptado en cursiva botánica, como en el aviso de duplicado. */
function Accepted({ name }: { name: string }) {
  return (
    <em className="font-display">
      <ScientificName name={name} />
    </em>
  )
}

/** Qué se distingue de cada una de varias especies en su botón. */
function chooseDetail(result: SpeciesSearchResult): string | null {
  switch (result.matchedNameType) {
    case 'synonym':
      return PLANT_FORM_TEXT.nameChooseSynonym(result.matchedName)
    case 'common':
      return PLANT_FORM_TEXT.nameChooseCommon(result.matchedName)
    case 'scientific':
      return result.type === 'hybrid' ? PLANT_FORM_TEXT.nameChooseHybrid : null
  }
}

/**
 * Nombre con autocompletado contra el catálogo (search_species). Elegir una
 * especie la enlaza; escribir algo que no está deja el nombre libre, "por
 * validar", y la acción final de la lista lo confirma.
 *
 * Nombre exacto (#280, regla en name-match.ts): el nombre aceptado de una sola
 * especie la enlaza solo, como si se hubiera elegido; un sinónimo, un nombre
 * común o varias especies se ofrecen bajo el campo para elegir con un toque
 * (y, en la lista, la única ofrecida queda destacada para Enter). El aviso de
 * «por validar» solo sale si la búsqueda terminó sin coincidencia exacta.
 */
export function NameField({
  values,
  dispatch,
  searchSpecies,
  error,
  inputRef,
  linkInitialName = false,
  onResolutionChange,
  offline = false,
}: NameFieldProps) {
  const errorId = useId()
  const linked = values.species !== null
  // Con una especie elegida no se busca: el texto es su nombre científico.
  // Sin conexión, tampoco (#296).
  const search = useCatalogSearch(searchSpecies, values.name, {
    enabled: !linked && !offline,
  })
  // Si el nombre se escribió sin conexión (o ya estaba al perderla): al
  // volver, la especie exacta solo se enlaza sola si no cambia el género ni
  // el tipo que la persona eligió entretanto; si no, se ofrece.
  const [checkedLater, setCheckedLater] = useState(
    () => offline && values.name.trim() !== '',
  )
  if (offline && !checkedLater && !linked && values.name.trim() !== '') {
    setCheckedLater(true)
  }

  const options: AutocompleteOption[] = search.results.map((result) => ({
    id: result.id,
    label: result.scientificName,
    secondary: speciesMatchText(result),
  }))

  // Texto para el que se eligió la acción "guardarla con este nombre"; deja
  // de valer en cuanto el texto cambia.
  const [freeNameChosenFor, setFreeNameChosenFor] = useState<string | null>(
    null,
  )
  const freeChosen = freeNameChosenFor === values.name
  const freeName = normalizePlantName(values.name)

  // Solo se enlaza solo lo que se escribió aquí (o el nombre inicial, con
  // linkInitialName).
  const [typed, setTyped] = useState(false)
  const autoLink = linkInitialName || typed
  const found: NameMatch =
    linked || search.status !== 'success'
      ? { kind: 'none' }
      : exactNameMatch(values.name, search.results)
  const keepsChoices = (result: SpeciesSearchResult) =>
    (values.genus === null || values.genus.id === result.genusId) &&
    (values.type === null || values.type === result.type)
  const exact: NameMatch =
    checkedLater && found.kind === 'link' && !keepsChoices(found.result)
      ? { kind: 'offer', result: found.result, by: 'scientific' }
      : found
  // Lo exacto que no se enlaza solo, se ofrece.
  const match: NameMatch =
    exact.kind === 'link' && (!autoLink || freeChosen)
      ? { kind: 'offer', result: exact.result, by: 'scientific' }
      : exact
  const offered =
    !freeChosen && (match.kind === 'offer' || match.kind === 'several')
      ? match
      : null
  const linkNow = match.kind === 'link' ? match.result : null

  // La especie del nombre exacto se enlaza sola, como si se hubiera elegido.
  useEffect(() => {
    if (linkNow === null) return
    dispatch({ type: 'speciesSelected', species: formSpeciesOf(linkNow) })
  }, [linkNow, dispatch])

  const resolution: NameResolution =
    linked || freeChosen
      ? 'settled'
      : search.status === 'loading' || linkNow !== null
        ? 'resolving'
        : offered !== null
          ? 'offer'
          : 'settled'
  // En la misma confirmación que lo que se ve (#311): con useEffect, el
  // registro se enteraba en una tarea posterior y, con el equipo cargado, un
  // Enter que llegara antes podía guardar sin esperar a enlazar la especie.
  useLayoutEffect(() => {
    onResolutionChange?.(resolution)
  }, [resolution, onResolutionChange])

  // El aviso de "por validar" sale al elegir la acción o cuando la búsqueda
  // ya terminó sin coincidencia exacta; mientras busca, no se adelanta.
  const pending =
    !offline &&
    isPendingName(values) &&
    (freeChosen || (search.status !== 'loading' && offered === null))
  // Con una especie elegida, la insignia «Coincidencia en el catálogo»
  // (#221) va en la ayuda, sobre el texto de siempre: el lector la lee con el
  // campo. Editar el texto desenlaza la especie y la insignia desaparece.
  const hint = linked ? (
    <span className="flex flex-col items-start gap-space-1">
      <MatchBadge className="mt-space-1">
        {PLANT_FORM_TEXT.nameMatch}
      </MatchBadge>{' '}
      <span>{PLANT_FORM_TEXT.nameHint}</span>
    </span>
  ) : offline ? (
    PLANT_FORM_TEXT.nameOfflineHint
  ) : pending ? (
    PLANT_FORM_TEXT.namePendingHint
  ) : (
    PLANT_FORM_TEXT.nameHint
  )

  const choose = (result: SpeciesSearchResult) => {
    dispatch({ type: 'speciesSelected', species: formSpeciesOf(result) })
  }

  let offerText: ReactNode = null
  if (offered?.kind === 'offer') {
    const { result, by } = offered
    offerText =
      by === 'scientific' ? (
        <>
          {PLANT_FORM_TEXT.nameOfferScientific}
          <Accepted name={result.scientificName} />
          {PLANT_FORM_TEXT.nameOfferAfter}
        </>
      ) : (
        <>
          {by === 'synonym' ? (
            <Accepted name={result.matchedName} />
          ) : (
            `«${result.matchedName}»`
          )}
          {by === 'synonym'
            ? PLANT_FORM_TEXT.nameOfferSynonym
            : PLANT_FORM_TEXT.nameOfferCommon}
          <Accepted name={result.scientificName} />
          {PLANT_FORM_TEXT.nameOfferAfter}
        </>
      )
  } else if (offered?.kind === 'several') {
    offerText = PLANT_FORM_TEXT.nameSeveral(offered.results.length)
  }
  const offeredResults =
    offered === null
      ? []
      : offered.kind === 'offer'
        ? [offered.result]
        : offered.results

  return (
    <div className="flex flex-col gap-space-1">
      <Autocomplete
        ref={inputRef}
        label={PLANT_FORM_TEXT.nameLabel}
        labelStyle="scientific"
        renderLabel={renderScientificName}
        value={values.name}
        onValueChange={(name) => {
          setTyped(true)
          setCheckedLater(offline)
          dispatch({ type: 'nameChanged', name })
        }}
        options={options}
        loading={search.status === 'loading'}
        error={search.error?.message}
        // Enlazada, la lista no tiene nada que mostrar (ni «No está en el
        // catálogo»): se cierra, también si se enlazó sola mientras estaba
        // abierta.
        minQueryLength={
          linked || offline ? Number.POSITIVE_INFINITY : SEARCH_QUERY_MIN_LENGTH
        }
        emptyText="No está en el catálogo."
        hint={hint}
        maxLength={PLANT_NAME_MAX_LENGTH}
        spellCheck={false}
        autoCorrect="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        suggestedOptionId={
          offered?.kind === 'offer' ? offered.result.id : undefined
        }
        onOptionSelect={(option) => {
          const result = search.results.find((item) => item.id === option.id)
          if (result) choose(result)
        }}
        action={
          !linked && !offline && freeName !== ''
            ? {
                label: PLANT_FORM_TEXT.freeNameAction(freeName),
                // El nombre ya está escrito: elegir la acción solo cierra la
                // lista y deja el nombre libre, sin pasos de más.
                onSelect: () => setFreeNameChosenFor(values.name),
              }
            : undefined
        }
      />
      {error && (
        <span id={errorId} className="orki-field__error">
          <Icon name="triangle-alert" />
          {error}
        </span>
      )}
      {/* Lo exacto que espera a que la persona elija (#280). La región está
          siempre montada para anunciarlo sin mover el foco; al enlazar una
          especie (sola o elegida), lo dice solo para el lector: la insignia
          ya se ve. */}
      <div
        className={
          offered === null
            ? undefined
            : 'mt-space-1 flex flex-col items-start gap-space-3 rounded-lg bg-neutral-50 p-space-3'
        }
      >
        <p
          role="status"
          className={
            offered === null
              ? 'sr-only'
              : 'text-sm text-neutral-900 [overflow-wrap:anywhere]'
          }
        >
          {offered !== null
            ? offerText
            : values.species
              ? PLANT_FORM_TEXT.nameLinked(values.species.scientificName)
              : ''}
        </p>
        {offeredResults.map((result) => {
          const detail =
            offered?.kind === 'several' ? chooseDetail(result) : null
          return (
            <Button
              key={result.id}
              className="max-w-full text-left [overflow-wrap:anywhere]"
              onClick={() => choose(result)}
            >
              <span>
                {PLANT_FORM_TEXT.nameChoose}{' '}
                <Accepted name={result.scientificName} />
                {/* El espacio va fuera del <span>: dentro, el nombre
                    accesible lo pierde. */}
                {detail && (
                  <>
                    {' '}
                    <span className="font-normal">{detail}</span>
                  </>
                )}
              </span>
            </Button>
          )
        })}
      </div>
    </div>
  )
}
