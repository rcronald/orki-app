import type { ReactNode } from 'react'
import { CATALOGUE_OF_LIFE_ATTRIBUTION } from '../backoffice/attribution.ts'
import { TextPage, type TextPageSection } from '../components/TextPage.tsx'
import { REFERENCE_LICENSES } from '../lib/referencePhotos.ts'

// Créditos y fuentes (/creditos, #203): lo que la app usa de otros y con qué
// licencia, con el diseño de página de texto (TextPage). Pública, en su propio
// chunk (carga diferida desde App.tsx) y sin Clerk.
//
// Cada dato está comprobado en el repositorio:
// - Catálogo: versión, DOI y licencia de scripts/catalog-import/fuente.json
//   (por backoffice/attribution.ts, un módulo sin React), con la indicación de
//   que se filtró y normalizó que pide CC BY 4.0 (FUENTE.md, sección 2). La
//   lista curada de híbridos: scripts/catalog-import/README.md.
// - Imágenes: src/assets/portada/LEEME.md y src/assets/fondos-genero/LEEME.md
//   (generadas con IA, OpenAI). Solo su origen: nada sobre sus derechos.
// - Tipografías: LICENSE de @fontsource/playfair-display y @fontsource/inter
//   (SIL Open Font License 1.1, con sus titulares).
// - Iconos: LICENSE de lucide-react (ISC; los derivados de Feather, MIT).
//
// - Fotos de referencia (#234): de iNaturalist, con las cuatro licencias que
//   acepta la base (species_photos_license_accepted, lib/referencePhotos.ts) y
//   la decisión del #180 sobre las versiones reducidas de las CC BY-SA. El
//   autor y la licencia de cada foto van junto a la foto, no aquí. Solo eso:
//   nada sobre derechos más allá de lo que dicen las licencias.

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} rel="noopener noreferrer" target="_blank">
      {children} <span className="sr-only">(se abre en otra pestaña)</span>
    </a>
  )
}

function sections(): TextPageSection[] {
  const { version, doiUrl, license, licenseUrl } = CATALOGUE_OF_LIFE_ATTRIBUTION
  return [
    {
      id: 'creditos-catalogo',
      title: 'Catálogo de especies',
      summary:
        'Las especies salen del Catalogue of Life; los híbridos de vivero, de una lista propia.',
      children: (
        <>
          <p>
            El catálogo de especies se basa en el{' '}
            <span lang="en">Catalogue of Life</span> ({version}),{' '}
            <External href={doiUrl}>{doiUrl}</External>, con licencia{' '}
            <External href={licenseUrl}>{license}</External>. En orqui.app se
            filtró a las orquídeas y se normalizó.
          </p>
          <p>
            Los híbridos de vivero, que el{' '}
            <span lang="en">Catalogue of Life</span> casi no trae, salen de una
            lista curada por el responsable del proyecto, con los nombres con
            los que se venden.
          </p>
        </>
      ),
    },
    {
      id: 'creditos-referencia',
      title: 'Fotos de referencia',
      summary:
        'Las fotos de referencia de las especies vienen de iNaturalist, cada una con su autor y su licencia.',
      children: (
        <>
          <p>
            Algunas especies del catálogo tienen una foto de referencia que
            enseña cómo es la especie. No son fotos de las plantas de ninguna
            colección. Vienen de{' '}
            <External href="https://www.inaturalist.org">
              <span lang="en">iNaturalist</span>
            </External>{' '}
            y cada una lleva, junto a la foto, su autor, su licencia y el enlace
            a la foto original.
          </p>
          <p>Solo se usan fotos con una de estas licencias:</p>
          <ul>
            <li>
              <External href={REFERENCE_LICENSES.cc0.url}>
                {REFERENCE_LICENSES.cc0.label}
              </External>{' '}
              (dedicación al dominio público).
            </li>
            <li>
              Fotos en{' '}
              <External href={REFERENCE_LICENSES.pd.url}>
                {REFERENCE_LICENSES.pd.label}
              </External>
              .
            </li>
            <li>
              <External href={REFERENCE_LICENSES['cc-by'].url}>
                {REFERENCE_LICENSES['cc-by'].label}
              </External>{' '}
              (Atribución).
            </li>
            <li>
              <External href={REFERENCE_LICENSES['cc-by-sa'].url}>
                {REFERENCE_LICENSES['cc-by-sa'].label}
              </External>{' '}
              (Atribución-CompartirIgual).
            </li>
          </ul>
          <p>
            orqui.app guarda una versión reducida de cada foto, y así lo indica
            («reducida») junto a ella. Las versiones reducidas de fotos con
            licencia CC BY-SA se comparten con esa misma licencia.
          </p>
        </>
      ),
    },
    {
      id: 'creditos-fotos',
      title: 'Imágenes',
      summary:
        'La foto de la portada y la ilustración de las cabeceras son imágenes generadas con IA.',
      children: (
        <p>
          La foto de la portada y la ilustración de orquídea de las cabeceras
          son imágenes generadas con IA (OpenAI) a petición del autor del
          proyecto. No son fotos de plantas reales de ninguna colección.
        </p>
      ),
    },
    {
      id: 'creditos-tipografias',
      title: 'Tipografías',
      summary:
        'Playfair Display e Inter, con la licencia SIL Open Font License 1.1.',
      children: (
        <>
          <ul>
            <li>
              <strong>Playfair Display</strong>: Copyright 2017 The Playfair
              Display Project Authors.
            </li>
            <li>
              <strong>Inter</strong>: Copyright 2016 The Inter Project Authors.
            </li>
          </ul>
          <p>
            Las dos tienen la licencia{' '}
            <External href="http://scripts.sil.org/OFL">
              SIL Open Font License 1.1
            </External>
            . La app las sirve ella misma, a partir de los paquetes de{' '}
            <External href="https://fontsource.org">Fontsource</External>.
          </p>
        </>
      ),
    },
    {
      id: 'creditos-iconos',
      title: 'Iconos',
      summary: 'Los iconos son de Lucide, con licencia ISC.',
      children: (
        <p>
          Los iconos son de{' '}
          <External href="https://lucide.dev">Lucide</External> (Copyright 2026
          Lucide Icons and Contributors), con licencia ISC. Algunos derivan de
          Feather (Copyright 2013 Cole Bemis), con licencia MIT.
        </p>
      ),
    },
  ]
}

export default function CreditsPage() {
  return (
    <TextPage
      title="Créditos y fuentes"
      lead="De dónde salen el catálogo, las fotos de referencia, las imágenes, las tipografías y los iconos de orqui.app, y con qué licencia."
      sections={sections()}
    />
  )
}
