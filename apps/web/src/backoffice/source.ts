import {
  countSpeciesPlants,
  getCatalogSummary,
  getGenus,
  getSpeciesDetail,
  listCatalogGenera,
  listCatalogSpecies,
  searchCatalogSpecies,
} from '../lib/catalogAdmin.ts'
import { searchGenera } from '../lib/catalogSearch.ts'

// De dónde lee la pantalla del catálogo. La app usa Supabase (las funciones de
// lib/catalogAdmin.ts); la página de muestra, datos fijos en memoria con la
// misma forma (showcase/catalog-admin-data.ts), para verla sin base de datos.

export interface CatalogAdminSource {
  listSpecies: typeof listCatalogSpecies
  searchSpecies: typeof searchCatalogSpecies
  listGenera: typeof listCatalogGenera
  summary: typeof getCatalogSummary
  speciesDetail: typeof getSpeciesDetail
  plantCount: typeof countSpeciesPlants
  genus: typeof getGenus
  /** Para el filtro de género (el mismo buscador que el registro). */
  searchGenera: typeof searchGenera
}

export const supabaseCatalogAdminSource: CatalogAdminSource = {
  listSpecies: listCatalogSpecies,
  searchSpecies: searchCatalogSpecies,
  listGenera: listCatalogGenera,
  summary: getCatalogSummary,
  speciesDetail: getSpeciesDetail,
  plantCount: countSpeciesPlants,
  genus: getGenus,
  searchGenera,
}
