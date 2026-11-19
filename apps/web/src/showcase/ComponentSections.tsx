import { useEffect, useState } from 'react'
import {
  Autocomplete,
  type AutocompleteOption,
} from '../components/ui/Autocomplete.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Chip } from '../components/ui/Chip.tsx'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import { Collapsible } from '../components/ui/Collapsible.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { ICON_NAMES } from '../components/ui/icons.ts'
import { OwnershipAnswer } from '../components/ui/OwnershipAnswer.tsx'
import { SpecimenCard } from '../components/ui/SpecimenCard.tsx'
import { StatusBadge } from '../components/ui/StatusBadge.tsx'
import { TextField } from '../components/ui/TextField.tsx'
import { filterOptions, GENERA, PLACES, PLANT_STATES, SPECIES } from './data.ts'
import samplePhoto from './foto-muestra.svg'
import { Example, Section } from './layout.tsx'

function IconSection() {
  return (
    <Section
      id="iconos"
      title="Iconos"
      description="Subconjunto de Lucide del sistema, con el componente Icon. Toman el color del texto y siempre acompañan a una palabra."
    >
      <ul className="grid grid-cols-2 gap-space-2 sm:grid-cols-4 lg:grid-cols-5">
        {ICON_NAMES.map((name) => (
          <li
            key={name}
            className="flex min-w-0 items-center gap-space-2 rounded-md bg-neutral-0 p-space-3 text-secondary"
          >
            <Icon name={name} className="flex-none" />
            <code className="text-xs break-words text-neutral-900">{name}</code>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function ButtonSection() {
  return (
    <Section
      id="botones"
      title="Botones"
      description="Button. Una sola acción primaria por pantalla; el texto es un verbo en infinitivo."
    >
      <div className="grid grid-cols-1 gap-space-4 md:grid-cols-2">
        <Example title="Variantes">
          <div className="flex flex-wrap gap-space-3">
            <Button variant="primary">Registrar orquídea</Button>
            <Button>Tomar foto</Button>
            <Button variant="danger">Borrar ejemplar</Button>
          </div>
        </Example>
        <Example title="Con icono">
          <div className="flex flex-wrap gap-space-3">
            <Button variant="primary" icon="plus">
              Agregar orquídea
            </Button>
            <Button icon="camera">Tomar foto</Button>
            <Button variant="danger" icon="trash-2">
              Borrar
            </Button>
          </div>
        </Example>
        <Example
          title="Ancho completo"
          description="Para la acción principal en el celular."
        >
          <Button variant="primary" block icon="check">
            Guardar
          </Button>
          <Button block>Cancelar</Button>
        </Example>
        <Example
          title="Inactivo"
          description="Mismo aspecto en las tres variantes. No recibe el foco."
        >
          <div className="flex flex-wrap gap-space-3">
            <Button variant="primary" disabled>
              Guardar
            </Button>
            <Button disabled>Tomar foto</Button>
            <Button variant="danger" disabled>
              Borrar
            </Button>
          </div>
        </Example>
      </div>
    </Section>
  )
}

function ChipSection() {
  const [genera, setGenera] = useState<ReadonlySet<string>>(
    () => new Set(['Phalaenopsis']),
  )
  const [plantState, setPlantState] = useState<string>('Activa')

  const toggleGenus = (genus: string) => {
    setGenera((current) => {
      const next = new Set(current)
      if (next.has(genus)) next.delete(genus)
      else next.add(genus)
      return next
    })
  }

  return (
    <Section
      id="chips"
      title="Chips"
      description="Chip y ChipGroup para filtrar o elegir una opción corta. Pulsa un chip para alternarlo."
    >
      <div className="grid grid-cols-1 gap-space-4 md:grid-cols-2">
        <Example
          title="Filtro de varios"
          description="Seleccionado con fondo color-primary-soft, borde color-primary e icono check."
        >
          <ChipGroup aria-label="Género">
            {GENERA.map((genus) => (
              <Chip
                key={genus}
                selected={genera.has(genus)}
                onClick={() => toggleGenus(genus)}
              >
                {genus}
              </Chip>
            ))}
          </ChipGroup>
        </Example>
        <Example
          title="Elección de uno"
          description="Estado de la planta: al elegir uno se deselecciona el anterior."
        >
          <ChipGroup aria-label="Estado de la planta">
            {PLANT_STATES.map((state) => (
              <Chip
                key={state}
                selected={plantState === state}
                onClick={() => setPlantState(state)}
              >
                {state}
              </Chip>
            ))}
          </ChipGroup>
        </Example>
      </div>
    </Section>
  )
}

function TextFieldSection() {
  return (
    <Section
      id="campos"
      title="Campo de texto"
      description="TextField. Etiqueta visible arriba; la ayuda y el error quedan enlazados al campo."
    >
      <div className="grid grid-cols-1 gap-space-4 md:grid-cols-3">
        <Example title="Normal">
          <TextField
            label="Nombre como la conoces"
            placeholder="Ej.: la mariposa blanca"
          />
        </Example>
        <Example title="Con ayuda">
          <TextField
            label="Lugar de compra"
            defaultValue="Vivero Moyobamba"
            hint="Opcional. Te ayuda a recordar dónde la conseguiste."
          />
        </Example>
        <Example title="Con error">
          <TextField
            label="Fecha de compra"
            defaultValue="31/02/2026"
            inputMode="numeric"
            error="Esa fecha no existe. Escríbela como 19/11/2026."
            hint="Día, mes y año."
          />
        </Example>
      </div>
    </Section>
  )
}

function BadgeSection() {
  return (
    <Section
      id="insignias"
      title="Insignias"
      description="StatusBadge. Solo dos estados, siempre con palabra e icono."
    >
      <Example title="Estados de validación del nombre">
        <div className="flex flex-wrap gap-space-3">
          <StatusBadge status="validated" />
          <StatusBadge status="pending" />
        </div>
      </Example>
    </Section>
  )
}

function CardSection() {
  return (
    <Section
      id="tarjetas"
      title="Tarjetas de ejemplar"
      description="SpecimenCard. La foto es el único color; sin foto se usa el marcador del sistema. En el celular van dos por fila."
    >
      <Example title="Con foto y validada; sin foto y por validar">
        <div className="grid grid-cols-2 gap-space-3 md:grid-cols-4">
          <SpecimenCard
            headingLevel={4}
            scientificName="Phalaenopsis amabilis"
            commonName="Orquídea mariposa"
            status="validated"
            meta="Vivero Moyobamba · 19/11/2026"
            photo={{
              src: samplePhoto,
              alt: 'Imagen de muestra: Phalaenopsis en floración',
            }}
          />
          <SpecimenCard
            headingLevel={4}
            scientificName="Masdevallia"
            commonName="La naranja del mercado"
            status="pending"
            meta="Mercado de flores de Acho · 02/08/2026"
          />
        </div>
      </Example>
    </Section>
  )
}

function AnswerSection() {
  return (
    <Section
      id="respuesta"
      title="Respuesta de ¿Ya la tengo?"
      description="OwnershipAnswer. La respuesta negativa es neutra, no un error."
    >
      <div className="grid grid-cols-1 gap-space-4 md:grid-cols-2">
        <Example title="Positiva">
          <OwnershipAnswer
            owned
            specimenCount={2}
            scientificName="Cattleya maxima"
          />
        </Example>
        <Example title="Negativa, con la acción principal">
          <OwnershipAnswer
            owned={false}
            scientificName="Phragmipedium kovachii"
          />
          <Button variant="primary" block icon="plus">
            Registrar orquídea
          </Button>
        </Example>
      </div>
    </Section>
  )
}

const SEARCH_DELAY_MS = 600

// Búsqueda simulada con retraso para que se vea el estado de carga, como la
// tendrá la consulta real al catálogo.
function useSimulatedSearch(
  source: readonly AutocompleteOption[],
  query: string,
) {
  const [result, setResult] = useState<{
    query: string
    options: AutocompleteOption[]
  }>({ query: '', options: [] })
  const trimmed = query.trim()

  useEffect(() => {
    if (trimmed === '') return
    const timer = setTimeout(() => {
      setResult({ query: trimmed, options: filterOptions(source, trimmed) })
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [source, trimmed])

  const loading = trimmed !== '' && result.query !== trimmed
  return { loading, options: loading ? [] : result.options }
}

function SearchSection() {
  const [species, setSpecies] = useState('')
  const [speciesChoice, setSpeciesChoice] = useState('')
  const search = useSimulatedSearch(SPECIES, species)

  const [place, setPlace] = useState('')
  const [placeChoice, setPlaceChoice] = useState('')

  return (
    <Section
      id="buscador"
      title="Buscador con autocompletado"
      description="Autocomplete. Flechas para moverte por las sugerencias, Enter para elegir y Escape para cerrar la lista (o borrar el texto si ya está cerrada)."
    >
      <div className="grid grid-cols-1 gap-space-4 md:grid-cols-2">
        <Example
          title="Nombre científico, con carga y acción final"
          description="Escribe «phal» o «wakanki»: primero aparece «Buscando…» y luego las sugerencias. Con un nombre que no está, como «Stanhopea», sale «Sin resultados» y la acción final."
        >
          <Autocomplete
            label="Nombre científico"
            labelStyle="scientific"
            hint="Busca por género, especie o nombre común."
            value={species}
            onValueChange={setSpecies}
            options={search.options}
            loading={search.loading}
            onOptionSelect={(option) => {
              setSpecies(option.label)
              setSpeciesChoice(`Elegiste ${option.label}.`)
            }}
            action={{
              label: 'No la encuentro: guardarla con este nombre',
              onSelect: () =>
                setSpeciesChoice(
                  `Se guardaría con el nombre «${species.trim()}», por validar.`,
                ),
            }}
          />
          <p role="status" className="text-sm text-neutral-700">
            {speciesChoice}
          </p>
        </Example>
        <Example
          title="Texto normal, sin acción"
          description="Escribe «vivero» o «lima». Las sugerencias llegan al instante."
        >
          <Autocomplete
            label="Lugar de compra"
            value={place}
            onValueChange={setPlace}
            options={filterOptions(PLACES, place)}
            onOptionSelect={(option) => {
              setPlace(option.label)
              setPlaceChoice(`Elegiste ${option.label}.`)
            }}
          />
          <p role="status" className="text-sm text-neutral-700">
            {placeChoice}
          </p>
        </Example>
      </div>
    </Section>
  )
}

function CollapsibleSection() {
  return (
    <Section
      id="plegable"
      title="Sección plegable"
      description="Collapsible. La cabecera es un botón; Enter o Espacio la abren y la cierran."
    >
      <div className="grid grid-cols-1 gap-space-4 md:grid-cols-2">
        <Example title="Cerrada">
          <Collapsible title="Más detalles" headingLevel={4}>
            <dl className="flex flex-col gap-space-2 text-sm text-neutral-900">
              <div>
                <dt className="font-semibold text-secondary">Riego</dt>
                <dd>Cada 7 días, sin encharcar.</dd>
              </div>
              <div>
                <dt className="font-semibold text-secondary">Luz</dt>
                <dd>Indirecta y brillante, junto a la ventana del este.</dd>
              </div>
              <div>
                <dt className="font-semibold text-secondary">Sustrato</dt>
                <dd>Corteza de pino, cambiado el 03/09/2026.</dd>
              </div>
            </dl>
          </Collapsible>
        </Example>
        <Example title="Abierta">
          <Collapsible title="Notas de floración" headingLevel={4} defaultOpen>
            <div className="flex flex-col gap-space-3">
              <ul className="flex list-disc flex-col gap-space-1 pl-space-5 text-sm text-neutral-900">
                <li>Abrió su primera vara el 12/10/2026.</li>
                <li>Siete flores, la última cayó el 15/11/2026.</li>
              </ul>
              <TextField
                label="Nota nueva"
                placeholder="Ej.: nueva vara floral"
              />
            </div>
          </Collapsible>
        </Example>
      </div>
    </Section>
  )
}

export function ComponentSections() {
  return (
    <>
      <IconSection />
      <ButtonSection />
      <ChipSection />
      <TextFieldSection />
      <BadgeSection />
      <CardSection />
      <AnswerSection />
      <SearchSection />
      <CollapsibleSection />
    </>
  )
}
