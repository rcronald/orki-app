import { useState } from 'react'
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
import type { FormGenus, NewPlantInsert } from '../registration/form-state.ts'
import {
  PlantForm,
  type PlantFormServices,
} from '../registration/PlantForm.tsx'
import {
  PLANT_INVALID_TEXT,
  PlantSaveError,
} from '../registration/save-plant.ts'
import { Example, Section } from './layout.tsx'

// El formulario de registro (/coleccion/nueva) con datos fijos, para revisarlo
// sin base de datos ni sesión. Guardar no escribe nada: dice qué se enviaría o
// simula el fallo elegido. Va plegado para no repetir en la página los nombres
// de los campos de las secciones de componentes.

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
    origin: null,
    location: null,
    nickname: null,
    flowerColor: null,
    photoInBloom: false,
    photoPath: null,
    thumbnailPath: null,
  }
}

export function RegistrationSection() {
  const [outcome, setOutcome] = useState<OutcomeId>('ok')
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
      description="PlantForm, la pantalla de /coleccion/nueva, con datos fijos: «phal», «wakanki» o «rhyncho» encuentran especies; cualquier otro nombre se guarda por validar. En «Otro», «mps» encuentra Miltoniopsis por su abreviatura. Guardar no escribe nada."
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
          <ChipGroup aria-label="Conexión del dispositivo">
            <Chip selected={!online} onClick={() => setOnline(!online)}>
              Sin conexión
            </Chip>
          </ChipGroup>
          <Example
            title="Registrar una orquídea"
            description="En el celular, las acciones quedan fijas abajo."
            className="mx-auto w-full max-w-lg"
          >
            {result === null ? (
              <PlantForm
                key={formKey}
                services={services}
                online={online}
                onSaved={(plant) =>
                  setResult(
                    `Guardada: «${plant.displayName}», ${
                      plant.validation === 'validated'
                        ? 'validada'
                        : 'nombre por validar'
                    }.`,
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
