import { Link } from 'react-router'
import { Pager } from '../catalog/Pager.tsx'
import { ActionList } from '../components/ui/ActionRow.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import { SpeciesRow } from '../catalog/SearchResults.tsx'
import { ReferencePhoto } from '../components/ui/ReferencePhoto.tsx'
import type { ReferencePicture } from '../lib/referencePhotos.ts'
import samplePhoto from './foto-muestra.svg'
import { Example, Section } from './layout.tsx'

/** Una foto de referencia de muestra (la ilustración de la muestra). */
const REFERENCE: ReferencePicture = {
  medium: { src: samplePhoto, width: 400, height: 300 },
  thumbnail: { src: samplePhoto, width: 400, height: 300 },
  credit: {
    author: 'Autora de muestra',
    license: 'cc-by-sa',
    sourceUrl: 'https://www.inaturalist.org/photos/12345',
    modified: true,
  },
  sourcePhotoId: '12345',
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'G', 'L', 'M', 'O', 'P', 'R', 'V']

const ROWS = [
  ['Cattleya purpurata', 'Cattleya · Sinónimo: Laelia purpurata'],
  ['× Rhyncholaeliocattleya Memoria Helen Brown', 'Híbrido'],
  ['Dendrobium', '1622 especies'],
] as const

// Piezas del catálogo público (#232): índice alfabético de géneros
// (orki-letters), filas de especie o género sobre orki-action y paginación
// (orki-pager). Datos ficticios; los enlaces no salen de la muestra.
export function CatalogPiecesSection() {
  return (
    <Section
      id="catalogo-piezas"
      title="Catálogo: piezas"
      description="Piezas del catálogo público (#232). Ver docs/piezas-de-interfaz.md."
    >
      <Example
        title="Índice alfabético (orki-letters)"
        description="Chips enlace de 44 × 44 px; la letra elegida, orki-chip--selected y aria-current. En escritorio se parten en filas; hasta 720 px, una sola fila con desplazamiento horizontal."
      >
        <nav aria-label="Géneros por letra (muestra)">
          <ul className="orki-letters">
            {LETTERS.map((letter) => (
              <li key={letter}>
                <Link
                  to="#catalogo-piezas"
                  className={`orki-chip orki-letters__link${letter === 'C' ? ' orki-chip--selected' : ''}`}
                  aria-current={letter === 'C' ? 'true' : undefined}
                >
                  {letter}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Example>
      <Example
        title="Filas de especie o de género (orki-action con scientific-name)"
        description="La fila de ActionRow con el nombre en cursiva botánica y, debajo, el género, el tipo o por qué nombre coincidió."
      >
        <ActionList>
          {ROWS.map(([name, detail]) => (
            <li key={name}>
              <Link to="#catalogo-piezas" className="orki-action">
                <span className="orki-action__text">
                  <span className="orki-action__title scientific-name">
                    <ScientificName name={name} />
                  </span>
                  <span className="orki-action__desc">{detail}</span>
                </span>
                <Icon name="chevron-right" />
              </Link>
            </li>
          ))}
        </ActionList>
      </Example>
      <Example
        title="Foto de referencia (ReferencePhoto, #234)"
        description="Una foto de iNaturalist que enseña cómo es la especie: siempre con el rótulo «Foto de referencia» y su crédito (autor, licencia enlazada a su texto legal, «reducida» y el original). Sin CSS propio. Si la imagen no carga, se retira."
      >
        <div className="flex flex-col gap-space-5">
          <ReferencePhoto
            picture={REFERENCE}
            scientificName="Phalaenopsis amabilis"
          />
          <ReferencePhoto
            picture={REFERENCE}
            scientificName="Phalaenopsis amabilis"
            variant="compact"
            title="Así es esta especie"
          />
          <ActionList>
            <li>
              <SpeciesRow
                to="#catalogo-piezas"
                name="Phalaenopsis amabilis"
                details={['Phalaenopsis']}
                reference={REFERENCE}
                reserve
              />
            </li>
            <li>
              <SpeciesRow
                to="#catalogo-piezas"
                name="Phalaenopsis equestris"
                details={['Phalaenopsis']}
                reserve
              />
            </li>
          </ActionList>
        </div>
      </Example>
      <Example
        title="Paginación (orki-pager)"
        description="«Anterior», «Página 2 de 5» y «Siguiente», enlaces con su dirección; en la primera y la última falta el que no lleva a ningún sitio. Hasta 720 px, la página arriba y los dos enlaces debajo."
      >
        <div className="flex flex-col gap-space-5">
          {[1, 2, 5].map((page) => (
            <Pager
              key={page}
              page={page}
              pageCount={5}
              pathFor={() => '#catalogo-piezas'}
              label={`Páginas (muestra, página ${page})`}
            />
          ))}
        </div>
      </Example>
    </Section>
  )
}
