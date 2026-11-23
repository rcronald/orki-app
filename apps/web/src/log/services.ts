import { createContext, useContext } from 'react'
import { appPhotoStorage, type PhotoStorage } from '../photos/storage.ts'
import { appPlantLogEntries, type PlantLogEntries } from './entries.ts'

// Servicios de la bitácora (#267): la base y el bucket. La app usa los de
// Supabase; las pruebas y /muestra pasan dobles en memoria con
// <PlantLogServicesContext value={...}>. Las imágenes se leen con
// usePlantImage (PlantImagesContext), como las de la galería.

export interface PlantLogServices {
  entries: PlantLogEntries
  storage: PhotoStorage
}

/** Servicios de la bitácora; null usa los de la app. */
export const PlantLogServicesContext = createContext<PlantLogServices | null>(
  null,
)

let shared: PlantLogServices | undefined

/** Los de la app, creados al pedirlos (siempre el mismo objeto). */
function appPlantLogServices(): PlantLogServices {
  shared ??= { entries: appPlantLogEntries(), storage: appPhotoStorage() }
  return shared
}

export function usePlantLogServices(): PlantLogServices {
  return useContext(PlantLogServicesContext) ?? appPlantLogServices()
}
