import {
  countSpeciesPlants,
  getCatalogSummary,
  getGenus,
  getGenusDetail,
  getSpeciesDetail,
  listCatalogGenera,
  listCatalogSpecies,
  searchCatalogSpecies,
} from '../lib/catalogAdmin.ts'
import { searchGenera } from '../lib/catalogSearch.ts'
import {
  addGenusAbbreviation,
  addSpeciesName,
  createCatalogGenus,
  createCatalogSpecies,
  deleteCatalogGenus,
  deleteCatalogSpecies,
  deleteGenusAbbreviation,
  deleteSpeciesName,
  setCatalogSpeciesStatus,
  updateCatalogGenus,
  updateCatalogSpecies,
  updateGenusAbbreviation,
  updateSpeciesName,
} from '../lib/catalogWrites.ts'

// De dónde lee y dónde escribe la pantalla del catálogo. La app usa Supabase
// (las funciones de lib/catalogAdmin.ts y lib/catalogWrites.ts); la página de
// muestra, un catálogo en memoria con la misma forma
// (showcase/catalog-admin-data.ts), para verla sin base de datos.

export interface CatalogAdminSource {
  listSpecies: typeof listCatalogSpecies
  searchSpecies: typeof searchCatalogSpecies
  listGenera: typeof listCatalogGenera
  summary: typeof getCatalogSummary
  speciesDetail: typeof getSpeciesDetail
  plantCount: typeof countSpeciesPlants
  genus: typeof getGenus
  genusDetail: typeof getGenusDetail
  /** Para el filtro de género (el mismo buscador que el registro). */
  searchGenera: typeof searchGenera
  // Escrituras (lib/catalogWrites.ts): fallan con CatalogWriteError.
  createSpecies: typeof createCatalogSpecies
  updateSpecies: typeof updateCatalogSpecies
  setSpeciesStatus: typeof setCatalogSpeciesStatus
  deleteSpecies: typeof deleteCatalogSpecies
  addName: typeof addSpeciesName
  updateName: typeof updateSpeciesName
  deleteName: typeof deleteSpeciesName
  createGenus: typeof createCatalogGenus
  updateGenus: typeof updateCatalogGenus
  deleteGenus: typeof deleteCatalogGenus
  addAbbreviation: typeof addGenusAbbreviation
  updateAbbreviation: typeof updateGenusAbbreviation
  deleteAbbreviation: typeof deleteGenusAbbreviation
}

export const supabaseCatalogAdminSource: CatalogAdminSource = {
  listSpecies: listCatalogSpecies,
  searchSpecies: searchCatalogSpecies,
  listGenera: listCatalogGenera,
  summary: getCatalogSummary,
  speciesDetail: getSpeciesDetail,
  plantCount: countSpeciesPlants,
  genus: getGenus,
  genusDetail: getGenusDetail,
  searchGenera,
  createSpecies: createCatalogSpecies,
  updateSpecies: updateCatalogSpecies,
  setSpeciesStatus: setCatalogSpeciesStatus,
  deleteSpecies: deleteCatalogSpecies,
  addName: addSpeciesName,
  updateName: updateSpeciesName,
  deleteName: deleteSpeciesName,
  createGenus: createCatalogGenus,
  updateGenus: updateCatalogGenus,
  deleteGenus: deleteCatalogGenus,
  addAbbreviation: addGenusAbbreviation,
  updateAbbreviation: updateGenusAbbreviation,
  deleteAbbreviation: deleteGenusAbbreviation,
}
