import { useState } from 'react'
import { Link } from 'react-router'
import { AppBar } from '../components/AppBar.tsx'
import { Avatar } from '../components/ui/Avatar.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Chip } from '../components/ui/Chip.tsx'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import { CollectionCard } from '../components/ui/CollectionCard.tsx'
import { FiltersButton } from '../components/ui/FiltersButton.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { MenuButton } from '../components/ui/MenuButton.tsx'
import { PageHeader } from '../components/ui/PageHeader.tsx'
import { QueryAnswer } from '../components/ui/QueryAnswer.tsx'
import { SearchField } from '../components/ui/SearchField.tsx'
import { SegmentedControl } from '../components/ui/SegmentedControl.tsx'
import { StatusBadge } from '../components/ui/StatusBadge.tsx'
import { PATHS } from '../routes/paths.ts'
import samplePhoto from './foto-muestra.svg'
import { Example, Section } from './layout.tsx'

// Piezas de «Mi colección» y «¿Ya la tengo?» (#206): barra de la app, cabecera
// de pantalla con la ilustración, barra de búsqueda del inventario, fila de
// chips desplazable, tarjeta de ejemplar con borde y resultado de consulta
// con sus tonos. Las mismas clases y componentes que usarán las pantallas
// (docs/piezas-de-interfaz.md).

const GENERA = [
  'Todos',
  'Cattleya',
  'Phalaenopsis',
  'Dendrobium',
  'Vanda',
  'Oncidium',
  'Masdevallia',
  'Epidendrum',
]

const VIEWS = [
  { value: 'grid', label: 'Cuadrícula', icon: 'layout-grid' },
  { value: 'list', label: 'Lista', icon: 'list' },
] as const

const PHOTO = { src: samplePhoto, alt: 'Foto de muestra' }

export function CollectionPiecesSection() {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [genus, setGenus] = useState('Todos')

  return (
    <Section
      id="coleccion-piezas"
      title="Mi colección y ¿Ya la tengo?: piezas"
      description="Piezas del rediseño (#206). El verde (color-secondary-strong) es la acción principal y la selección en toda la app; el rosa queda para la marca."
    >
      <Example
        title="Barra de la app con sesión (AppBar)"
        description="Logotipo que enlaza al inicio, pestaña «Mi colección» con icono (subrayada y con aria-current en la colección y sus pantallas) y, a la derecha, el menú de la cuenta. Sin lupa. Hasta 720 px, logotipo más pequeño y la cuenta solo con su foto."
      >
        <AppBar
          account={
            <MenuButton
              header={
                <>
                  <strong>Ana López</strong>ana@example.com
                </>
              }
              items={[
                { kind: 'link', label: 'Mi cuenta', icon: 'user', to: '#' },
                {
                  kind: 'link',
                  label: 'Administración',
                  icon: 'settings',
                  to: '#',
                },
                { kind: 'separator' },
                {
                  kind: 'action',
                  label: 'Cerrar sesión',
                  icon: 'log-out',
                  onSelect: () => {},
                },
              ]}
            >
              <Avatar name="Ana López" />
              <span className="orki-menu__label">Tu cuenta</span>
            </MenuButton>
          }
        />
      </Example>
      <Example
        title="Cabecera de pantalla (PageHeader)"
        description="Título en font-display y color-secondary-strong, contador en color-neutral-700, hasta dos acciones (a la derecha; apiladas a todo el ancho hasta 720 px) e ilustración decorativa en la esquina."
      >
        <PageHeader
          headingLevel={2}
          title="Mi colección"
          meta="18 ejemplares · 5 géneros"
          actions={
            <>
              <Button variant="primary" icon="plus">
                Registrar orquídea
              </Button>
              <Button icon="circle-check">¿Ya la tengo?</Button>
            </>
          }
        />
      </Example>
      <Example
        title="Cabecera centrada (variant «center»)"
        description="Para pantallas de una sola tarea: enlace de volver, título centrado y frase de apoyo."
      >
        <PageHeader
          headingLevel={2}
          variant="center"
          title="¿Ya la tengo?"
          meta="Comprueba si una orquídea ya está en tu colección."
          back={
            <Link to={PATHS.showcase} className="orki-link orki-pagehead__back">
              <Icon name="arrow-left" />
              Volver a Mi colección
            </Link>
          }
        />
      </Example>
      <Example
        title="Barra de búsqueda del inventario"
        description="SearchField (lupa y botón de borrar), FiltersButton con el número de filtros activos y SegmentedControl de cuadrícula o lista, dentro de orki-toolbar."
      >
        <div className="orki-toolbar">
          <SearchField
            label="Buscar en mi colección"
            hideLabel
            placeholder="Buscar en mi colección"
            value={query}
            onValueChange={setQuery}
          />
          <FiltersButton activeCount={2} />
          <SegmentedControl
            label="Vista"
            options={VIEWS}
            value={view}
            onValueChange={setView}
            iconOnly
          />
        </div>
      </Example>
      <Example
        title="Fila de chips desplazable (ChipGroup scroll)"
        description="Una sola fila con desplazamiento horizontal y sin barra visible; Tab recorre los chips. El seleccionado va relleno en verde."
      >
        <ChipGroup aria-label="Accesos por género" scroll>
          {GENERA.map((name) => (
            <Chip
              key={name}
              selected={genus === name}
              onClick={() => setGenus(name)}
            >
              {name}
            </Chip>
          ))}
        </ChipGroup>
      </Example>
      <Example
        title="Tarjeta de ejemplar con borde (CollectionCard)"
        description="Borde fino color-neutral-200 sobre color-neutral-0, sin sombra; foto 3:2, nombre en cursiva, apodo, insignia solo si aplica y ubicación con map-pin. Con más de una foto (photoCount), el número sobre la esquina de la foto (orki-count con el icono image), descrito como «3 fotos» para el lector. Con layout «list», la fila de la vista en lista."
      >
        <div className="grid grid-cols-2 gap-space-3 md:grid-cols-3">
          <CollectionCard
            scientificName="Cattleya trianae"
            location="Invernadero este"
            photo={PHOTO}
            renderName={(name) => (
              <a className="orki-card__link" href="#coleccion-piezas">
                {name}
              </a>
            )}
          />
          <CollectionCard
            scientificName="Phalaenopsis bellina"
            nickname="La del balcón"
            location="Terrario"
            photo={PHOTO}
            photoCount={3}
          />
          <CollectionCard
            scientificName="Dendrobium Stardust"
            nameStyle="plain"
            badge={<StatusBadge status="pending" />}
            location="Invernadero este"
          />
        </div>
        <div className="flex flex-col gap-space-2">
          <CollectionCard
            layout="list"
            scientificName="Vanda coerulea"
            nickname="Azul"
            location="Colgante de la terraza"
            photo={PHOTO}
            photoCount={6}
          />
          <CollectionCard layout="list" scientificName="Oncidium sphacelatum" />
        </div>
      </Example>
      <Example
        title="Resultado de consulta (QueryAnswer)"
        description="Sobre color-secondary-soft con icono redondo, título, dato secundario y enlace de acción (a la derecha; debajo hasta 720 px). Tonos: sí, parecidas, no (neutro) y aviso."
      >
        <div className="flex flex-col gap-space-3">
          <QueryAnswer
            tone="yes"
            title="Sí, la tienes"
            detail="2 ejemplares"
            action={
              <Link
                to={PATHS.showcase}
                className="orki-link orki-answer__action"
              >
                Ver en mi colección
                <Icon name="arrow-right" />
              </Link>
            }
          />
          <QueryAnswer
            tone="similar"
            title="Tienes parecidas"
            detail="3 ejemplares del género Cattleya"
          />
          <QueryAnswer
            tone="no"
            title="Aún no la tienes"
            detail="Phragmipedium kovachii no está en tu colección."
          />
          <QueryAnswer
            tone="notice"
            title="Sin copia disponible"
            detail="Conéctate una vez para guardar tu colección en este dispositivo."
          />
        </div>
      </Example>
    </Section>
  )
}
