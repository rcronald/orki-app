import { useRef, useState } from 'react'
import type { CollectionPlant } from '../collection/model.ts'
import { Button } from '../components/ui/Button.tsx'
import { Chip } from '../components/ui/Chip.tsx'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import { Collapsible } from '../components/ui/Collapsible.tsx'
import {
  CatalogSearchError,
  type CatalogSearchOptions,
  type GenusSearchResult,
  type SpeciesSearchResult,
} from '../lib/catalogSearch.ts'
import { normalizeSearchText } from '../collection/normalize.ts'
import { createMemoryPhotoStorage } from '../photos/memory-storage.ts'
import { PhotoStorageError } from '../photos/storage.ts'
import { replacePlantPhoto } from '../photos/upload.ts'
import type { FormGenus, NewPlantInsert } from '../registration/form-state.ts'
import {
  PlantForm,
  type PlantFormServices,
} from '../registration/PlantForm.tsx'
import {
  PLANT_INVALID_TEXT,
  PlantSaveError,
} from '../registration/save-plant.ts'
import { SAMPLE_COLLECTION } from './inventory-data.ts'
import { Example, Section } from './layout.tsx'

// El formulario de registro (/coleccion/nueva) con datos fijos, para revisarlo
// sin base de datos ni sesión. Guardar no escribe nada: dice qué se enviaría o
// simula el fallo elegido. Va plegado para no repetir en la página los nombres
// de los campos de las secciones de componentes.
//
// Las sugerencias de origen y el aviso de duplicado salen de la colección de
// ejemplo del inventario, con Phalaenopsis amabilis enlazada a la especie de
// esta muestra: dos ejemplares activos y uno regalado (que no cuenta).
// El borrador es real (localStorage y, la foto, IndexedDB, usuario
// "muestra"): recargar la página a mitad lo recupera. La foto se sube con
// replacePlantPhoto a un bucket en memoria (memory-storage.ts), como en la
// sección "Fotos", y puede fallar a voluntad.
//
// El fondo por género (#13) va dentro de la zona de ejemplo (backdrop
// "contained"), no en toda la página: al elegir Phalaenopsis o Cattleya (o
// cualquiera de los cinco de acceso rápido) aparece su foto, hoy PROVISIONAL,
// bajo el velo overlay-genus.

const AMABILIS_SPECIES = {
  id: 'especie-amabilis',
  scientificName: 'Phalaenopsis amabilis',
  type: 'species',
  status: 'validated',
} as const

const KNOWN_PLANTS: readonly CollectionPlant[] = [
  ...SAMPLE_COLLECTION.map((plant) =>
    plant.displayName === AMABILIS_SPECIES.scientificName
      ? { ...plant, species: AMABILIS_SPECIES }
      : plant,
  ),
  ...SAMPLE_COLLECTION.filter(
    (plant) => plant.displayName === AMABILIS_SPECIES.scientificName,
  ).flatMap((plant) => [
    {
      ...plant,
      id: `${plant.id}-otra`,
      nickname: null,
      species: AMABILIS_SPECIES,
    },
    {
      ...plant,
      id: `${plant.id}-regalada`,
      nickname: null,
      status: 'gifted' as const,
      species: AMABILIS_SPECIES,
    },
  ]),
]

/** Dueño del borrador de la muestra; no es un usuario de Clerk. */
const SHOWCASE_DRAFT_USER = 'muestra'

const GENERA: Record<string, FormGenus> = {
  cattleya: { id: 'genero-cattleya', name: 'Cattleya' },
  dendrobium: { id: 'genero-dendrobium', name: 'Dendrobium' },
  oncidium: { id: 'genero-oncidium', name: 'Oncidium' },
  phalaenopsis: { id: 'genero-phalaenopsis', name: 'Phalaenopsis' },
  vanda: { id: 'genero-vanda', name: 'Vanda' },
  masdevallia: { id: 'genero-masdevallia', name: 'Masdevallia' },
  miltoniopsis: { id: 'genero-miltoniopsis', name: 'Miltoniopsis' },
  rhyncholaeliocattleya: {
    id: 'genero-rlc',
    name: '× Rhyncholaeliocattleya',
  },
}

const QUICK_GENERA = [
  GENERA.cattleya,
  GENERA.dendrobium,
  GENERA.oncidium,
  GENERA.phalaenopsis,
  GENERA.vanda,
].filter((genus) => genus !== undefined)

function species(
  id: string,
  scientificName: string,
  genus: FormGenus | undefined,
  match: Pick<SpeciesSearchResult, 'matchedName' | 'matchedNameType'> = {
    matchedName: scientificName,
    matchedNameType: 'scientific',
  },
  type: SpeciesSearchResult['type'] = 'species',
): SpeciesSearchResult {
  return {
    id,
    scientificName,
    genusId: genus?.id ?? '',
    genusName: genus?.name ?? '',
    type,
    status: 'validated',
    ...match,
  }
}

const SPECIES: readonly SpeciesSearchResult[] = [
  species('especie-amabilis', 'Phalaenopsis amabilis', GENERA.phalaenopsis),
  species('especie-aphrodite', 'Phalaenopsis aphrodite', GENERA.phalaenopsis, {
    matchedName: 'Phalaenopsis amabilis var. aphrodite',
    matchedNameType: 'synonym',
  }),
  species('especie-maxima', 'Cattleya maxima', GENERA.cattleya, {
    matchedName: 'Flor de mayo',
    matchedNameType: 'common',
  }),
  species('especie-veitchiana', 'Masdevallia veitchiana', GENERA.masdevallia, {
    matchedName: 'Wakanki',
    matchedNameType: 'common',
  }),
  species(
    'especie-rlc',
    '× Rhyncholaeliocattleya Memoria Anna Balmores',
    GENERA.rhyncholaeliocattleya,
    undefined,
    'hybrid',
  ),
]

const OTHER_GENERA: readonly GenusSearchResult[] = Object.values(GENERA).map(
  (genus) => ({
    id: genus.id,
    name: genus.name,
    isQuickAccess: QUICK_GENERA.includes(genus),
    matchedAbbreviation: genus.name === 'Miltoniopsis' ? 'Mps.' : null,
  }),
)

const DELAY_MS = 400

/** Espera `ms` o se rechaza como cancelada, igual que la búsqueda real. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new CatalogSearchError('aborted'))
    })
  })
}

function matches(text: string, query: string): boolean {
  return normalizeSearchText(text).includes(normalizeSearchText(query))
}

async function searchSpecies(
  query: string,
  options: CatalogSearchOptions = {},
): Promise<SpeciesSearchResult[]> {
  await delay(DELAY_MS, options.signal)
  return SPECIES.filter(
    (item) =>
      matches(item.scientificName, query) || matches(item.matchedName, query),
  )
}

async function searchGenera(
  query: string,
  options: CatalogSearchOptions = {},
): Promise<GenusSearchResult[]> {
  await delay(DELAY_MS, options.signal)
  return OTHER_GENERA.filter(
    (item) =>
      matches(item.name, query) ||
      (item.matchedAbbreviation !== null &&
        matches(item.matchedAbbreviation, query)),
  )
}

const loadQuickGenera = () => Promise.resolve(QUICK_GENERA)

const OUTCOMES = [
  { id: 'ok', label: 'Guarda bien' },
  { id: 'offline', label: 'Falla sin conexión' },
  { id: 'session-ended', label: 'Sesión terminada' },
  { id: 'failed', label: 'Error del servidor' },
  { id: 'invalid', label: 'La base rechaza la fecha' },
] as const

type OutcomeId = (typeof OUTCOMES)[number]['id']

const PHOTO_OUTCOMES = [
  { id: 'ok', label: 'La foto sube bien' },
  { id: 'offline', label: 'La foto falla sin conexión' },
  { id: 'session-ended', label: 'La foto falla por la sesión' },
] as const

type PhotoOutcomeId = (typeof PHOTO_OUTCOMES)[number]['id']

const photoStorage = createMemoryPhotoStorage(700)

/** La planta que devolvería la base para `insert`. */
function samplePlant(insert: NewPlantInsert): CollectionPlant {
  const linked = SPECIES.find((item) => item.id === insert.species_id) ?? null
  const genus =
    Object.values(GENERA).find(
      (item) => item.id === (linked?.genusId ?? insert.genus_id),
    ) ?? QUICK_GENERA[0]
  const now = new Date().toISOString()
  return {
    id: insert.id,
    displayName: linked?.scientificName ?? insert.entered_name,
    displayNameIsScientific: linked !== null,
    enteredName: insert.entered_name,
    species: linked
      ? {
          id: linked.id,
          scientificName: linked.scientificName,
          type: linked.type,
          status: linked.status,
        }
      : null,
    genus: genus ?? { id: insert.genus_id, name: '' },
    type: linked?.type ?? insert.type,
    validation: linked ? 'validated' : 'pending',
    status: 'active',
    acquiredOn: insert.acquired_on,
    createdAt: now,
    updatedAt: now,
    origin: insert.origin ?? null,
    location: insert.location ?? null,
    nickname: insert.nickname ?? null,
    flowerColor: insert.flower_color ?? null,
    photoInBloom: insert.photo_in_bloom ?? false,
    photoPath: null,
    thumbnailPath: null,
  }
}

export function RegistrationSection() {
  const [outcome, setOutcome] = useState<OutcomeId>('ok')
  const [photoOutcome, setPhotoOutcome] = useState<PhotoOutcomeId>('ok')
  // El reintento repite la tarea de la primera subida (usePhotoUpload), con
  // los servicios de entonces: el resultado elegido se lee de una ref para
  // que valga el que esté elegido al reintentar.
  const photoOutcomeRef = useRef(photoOutcome)
  const [photoFirst, setPhotoFirst] = useState(false)
  const [online, setOnline] = useState(true)
  const [result, setResult] = useState<string | null>(null)
  // Cambiar la clave vuelve a montar el formulario vacío.
  const [formKey, setFormKey] = useState(0)
  const [lastInsert, setLastInsert] = useState<NewPlantInsert | null>(null)

  const services: PlantFormServices = {
    searchSpecies,
    searchGenera,
    loadQuickGenera,
    savePlant: async (insert) => {
      setLastInsert(insert)
      await delay(DELAY_MS * 2)
      switch (outcome) {
        case 'ok':
          return samplePlant(insert)
        case 'invalid':
          throw new PlantSaveError('invalid', {
            message: PLANT_INVALID_TEXT.futureDate,
          })
        default:
          throw new PlantSaveError(outcome)
      }
    },
    uploadPhoto: (files, options) => {
      // El fallo elegido se aplica justo antes de cada subida, así el
      // reintento usa el que esté elegido entonces.
      const failure = photoOutcomeRef.current
      photoStorage.failUploads =
        failure === 'ok'
          ? undefined
          : () =>
              new PhotoStorageError(failure, {
                uncertain: failure === 'offline',
              })
      return replacePlantPhoto(files, {
        ...options,
        storage: photoStorage,
        // La planta "en la base" es la que devolvió el guardado.
        records: {
          setPhotoPaths: (_plantId, _userId, paths) =>
            Promise.resolve({
              ...options.plant,
              photoPath: paths?.photoPath ?? null,
              thumbnailPath: paths?.thumbnailPath ?? null,
            }),
          deletePlant: () => Promise.resolve(),
        },
      })
    },
  }

  const restart = () => {
    setResult(null)
    setLastInsert(null)
    setFormKey((key) => key + 1)
  }

  return (
    <Section
      id="registro"
      title="Formulario de registro"
      description="PlantForm, la pantalla de /coleccion/nueva, con datos fijos: «phal», «wakanki» o «rhyncho» encuentran especies; cualquier otro nombre se guarda por validar. En «Otro», «mps» encuentra Miltoniopsis por su abreviatura. Phalaenopsis amabilis avisa de que ya tienes 2 ejemplares. El origen sugiere los de la colección de ejemplo (prueba «mercado» o «orquideas»). La foto es opcional: se sube después de guardar la planta a un bucket simulado, y si falla se puede reintentar o continuar sin ella. Lo escrito y la foto se conservan como borrador en este navegador: recarga la página a mitad y vuelve a abrir el formulario. Guardar no escribe nada. Al fijar uno de los cinco géneros de acceso rápido, el fondo del ejemplo pasa a su foto (provisional) bajo el velo; los demás géneros dejan el fondo neutro."
    >
      <Collapsible title="Ver el formulario" headingLevel={3}>
        <div className="flex flex-col gap-space-4 pt-space-3">
          <ChipGroup aria-label="Resultado al guardar">
            {OUTCOMES.map((item) => (
              <Chip
                key={item.id}
                selected={outcome === item.id}
                onClick={() => setOutcome(item.id)}
              >
                {item.label}
              </Chip>
            ))}
          </ChipGroup>
          <ChipGroup aria-label="Resultado al subir la foto">
            {PHOTO_OUTCOMES.map((item) => (
              <Chip
                key={item.id}
                selected={photoOutcome === item.id}
                onClick={() => {
                  photoOutcomeRef.current = item.id
                  setPhotoOutcome(item.id)
                }}
              >
                {item.label}
              </Chip>
            ))}
          </ChipGroup>
          <ChipGroup aria-label="Entrada al registro">
            <Chip
              selected={photoFirst}
              onClick={() => {
                setPhotoFirst(!photoFirst)
                restart()
              }}
            >
              Empezar por la foto (?foto=1)
            </Chip>
          </ChipGroup>
          <ChipGroup aria-label="Conexión del dispositivo">
            <Chip selected={!online} onClick={() => setOnline(!online)}>
              Sin conexión
            </Chip>
          </ChipGroup>
          <Example
            title="Registrar una orquídea"
            description="En el celular, las acciones quedan fijas abajo."
            className="relative isolate mx-auto w-full max-w-lg"
          >
            {result === null ? (
              <PlantForm
                key={formKey}
                services={services}
                online={online}
                knownPlants={KNOWN_PLANTS}
                draftUserId={SHOWCASE_DRAFT_USER}
                photoFirst={photoFirst}
                backdrop="contained"
                onSaved={(plant) =>
                  setResult(
                    `Guardada: «${plant.displayName}», ${
                      plant.validation === 'validated'
                        ? 'validada'
                        : 'nombre por validar'
                    }, ${plant.photoPath ? `con foto (${plant.photoPath})` : 'sin foto'}.`,
                  )
                }
                onCancel={() => setResult('Cancelado sin guardar.')}
              />
            ) : (
              <div className="flex flex-col items-start gap-space-3">
                <p role="status" className="text-md text-neutral-900">
                  {result}
                </p>
                {lastInsert && (
                  <pre className="w-full overflow-x-auto rounded-md bg-neutral-50 p-space-3 text-xs">
                    {JSON.stringify(lastInsert, null, 2)}
                  </pre>
                )}
                <Button icon="plus" onClick={restart}>
                  Registrar otra
                </Button>
              </div>
            )}
          </Example>
        </div>
      </Collapsible>
    </Section>
  )
}
