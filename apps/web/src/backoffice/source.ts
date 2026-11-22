import {
  countProposalGroups,
  countSpeciesPlants,
  getCatalogSummary,
  getGenus,
  getGenusDetail,
  getSpeciesDetail,
  getSpeciesHistory,
  listCatalogGenera,
  listCatalogSpecies,
  listProposalGroups,
  searchCatalogSpecies,
} from '../lib/catalogAdmin.ts'
import { searchGenera } from '../lib/catalogSearch.ts'
import {
  addGenusAbbreviation,
  addSpeciesName,
  createCatalogGenus,
  createCatalogSpecies,
  createSpeciesFromProposal,
  deleteCatalogGenus,
  deleteCatalogSpecies,
  deleteGenusAbbreviation,
  deleteSpeciesName,
  linkProposalGroup,
  markProposalUnidentifiable,
  mergeCatalogSpecies,
  previewSpeciesMerge,
  setCatalogSpeciesStatus,
  updateCatalogGenus,
  updateCatalogSpecies,
  updateGenusAbbreviation,
  updateSpeciesName,
} from '../lib/catalogWrites.ts'
import {
  createPlantImageSource,
  type PlantImageSource,
} from '../photos/read.ts'

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
  /** Historial de la especie (auditoría), por páginas. */
  speciesHistory: typeof getSpeciesHistory
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
  // Fusión de especies: la vista previa (una lectura, falla con
  // CatalogAdminError salvo los rechazos de la fusión) y la fusión.
  previewMerge: typeof previewSpeciesMerge
  mergeSpecies: typeof mergeCatalogSpecies
  // Cola de propuestas (#140): lecturas (CatalogAdminError) y resoluciones
  // (CatalogWriteError).
  listProposals: typeof listProposalGroups
  countProposals: typeof countProposalGroups
  linkProposal: typeof linkProposalGroup
  createSpeciesFromProposal: typeof createSpeciesFromProposal
  markProposalUnidentifiable: typeof markProposalUnidentifiable
  /** De dónde salen las fotos de las propuestas (ver proposalImages abajo). */
  proposalImages: () => PlantImageSource
}

let proposalImages: PlantImageSource | undefined

/**
 * Fotos de las propuestas: descarga autenticada del bucket, como en la app,
 * pero sin guardar las miniaturas en Cache Storage, porque son de otros
 * usuarios y el administrador deja de poder leerlas al resolver el grupo.
 */
function supabaseProposalImages(): PlantImageSource {
  proposalImages ??= createPlantImageSource({ thumbnailCache: null })
  return proposalImages
}

export const supabaseCatalogAdminSource: CatalogAdminSource = {
  listSpecies: listCatalogSpecies,
  searchSpecies: searchCatalogSpecies,
  listGenera: listCatalogGenera,
  summary: getCatalogSummary,
  speciesDetail: getSpeciesDetail,
  plantCount: countSpeciesPlants,
  speciesHistory: getSpeciesHistory,
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
  previewMerge: previewSpeciesMerge,
  mergeSpecies: mergeCatalogSpecies,
  listProposals: listProposalGroups,
  countProposals: countProposalGroups,
  linkProposal: linkProposalGroup,
  createSpeciesFromProposal,
  markProposalUnidentifiable,
  proposalImages: supabaseProposalImages,
}
