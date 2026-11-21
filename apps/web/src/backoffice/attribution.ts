// Atribución del Catalogue of Life (CC BY 4.0), tal como la pide
// scripts/catalog-import/FUENTE.md (sección 2).
//
// La versión, el DOI y la licencia salen de scripts/catalog-import/fuente.json,
// el mismo archivo que fija la versión que carga la importación: Vite lo lee al
// compilar y solo incluye estos campos en el chunk del backoffice. Al pasar a
// una versión nueva de COL basta con cambiar fuente.json (ver "Nueva versión de
// la fuente" en scripts/catalog-import/README.md).
//
// Supuesto: la base tiene cargada la versión de fuente.json. Si un ambiente
// aún no se recargó con la versión nueva, la atribución dirá la nueva hasta
// que se cargue.
import {
  alias,
  doi,
  licencia,
  licencia_url,
} from '../../../../scripts/catalog-import/fuente.json'

export const CATALOGUE_OF_LIFE_ATTRIBUTION = {
  /** Versión de COL, por ejemplo "COL26.10 XR". */
  version: alias,
  doiUrl: `https://doi.org/${doi}`,
  license: licencia,
  licenseUrl: licencia_url,
} as const

/**
 * Ficha de un taxón de COL a partir de su clave (`source_ref` de las especies
 * con fuente `col`). Es la forma que recomienda FUENTE.md.
 */
export function catalogueOfLifeTaxonUrl(sourceRef: string): string {
  return `https://www.catalogueoflife.org/data/taxon/${encodeURIComponent(sourceRef)}`
}
