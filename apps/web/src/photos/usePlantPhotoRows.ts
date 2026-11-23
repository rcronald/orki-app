import { createContext, useContext } from 'react'
import { appPlantPhotoRows, type PlantPhotoRows } from './photo-rows.ts'

// Filas de plant_photos para las pantallas (#183), como PlantImagesContext para
// las imágenes: la galería del detalle no sabe de PostgREST. Las pruebas y la
// página de muestra pasan el doble en memoria con
// <PlantPhotoRowsContext value={...}>.

/** Filas de plant_photos; null usa las de la app (Supabase). */
export const PlantPhotoRowsContext = createContext<PlantPhotoRows | null>(null)

export function usePlantPhotoRows(): PlantPhotoRows {
  return useContext(PlantPhotoRowsContext) ?? appPlantPhotoRows()
}
