import { localDateString } from '../lib/localDate.ts'
import {
  FLOWER_COLOR_LABEL,
  PLANT_STATUS_LABEL,
  PLANT_TYPE_LABEL,
  PLANT_VALIDATION_LABEL,
} from './labels.ts'
import type { CollectionPlant } from './model.ts'
import { groupByGenus } from './selectors.ts'

// Exportación del inventario a CSV (#17): una función pura que convierte la
// colección en memoria en el texto del archivo. No pide nada a la red.
//
// - Qué: todas las plantas del usuario, también las perdidas y regaladas, sin
//   importar los filtros ni la búsqueda (lo pide el issue: es una copia de la
//   colección, no de la pantalla).
// - Orden: por género (alfabético, sin tener en cuenta el "×") y, dentro de
//   cada género, por nombre mostrado; el mismo orden que la vista agrupada.
// - Formato: separador coma (el de la configuración regional de Perú; un
//   Excel configurado para España espera punto y coma), fin de línea CRLF
//   (RFC 4180), UTF-8 con marca de orden de bytes para que Excel muestre las
//   tildes, la ñ y el "×", y fechas "AAAA-MM-DD".
// - Escapado (RFC 4180): una celda con coma, comillas, salto de línea o
//   espacios al principio o al final va entre comillas, y cada comilla se
//   duplica.
// - Fórmulas: una celda que empieza por "=", "+", "-", "@", tabulador o
//   retorno de carro (también tras espacios) se neutraliza anteponiendo un
//   apóstrofo, la regla de OWASP contra la inyección de fórmulas: la hoja de
//   cálculo la trata como texto. El resto del valor queda intacto: un apodo
//   "-la pequeña" se exporta como "'-la pequeña" (sin el apóstrofo, Excel
//   lo tomaría por una fórmula y mostraría un error). Las fechas y los textos
//   fijos de la app nunca empiezan por esos caracteres.

/** Marca de orden de bytes de UTF-8, al principio del archivo. */
export const BOM = '﻿'
export const SEPARATOR = ','
export const LINE_END = '\r\n'

interface Column {
  header: string
  value: (plant: CollectionPlant) => string
}

const text = (value: string | null): string => value ?? ''

/** Columnas del archivo, en orden: cabecera y valor de cada planta. */
export const CSV_COLUMNS: readonly Column[] = [
  {
    header: 'Nombre científico',
    value: (plant) => text(plant.species?.scientificName ?? null),
  },
  { header: 'Nombre ingresado', value: (plant) => plant.enteredName },
  { header: 'Género', value: (plant) => plant.genus.name },
  { header: 'Tipo', value: (plant) => PLANT_TYPE_LABEL[plant.type] },
  { header: 'Estado', value: (plant) => PLANT_STATUS_LABEL[plant.status] },
  {
    header: 'Validación',
    value: (plant) => PLANT_VALIDATION_LABEL[plant.validation],
  },
  { header: 'Fecha de adquisición', value: (plant) => plant.acquiredOn },
  { header: 'Origen', value: (plant) => text(plant.origin) },
  { header: 'Ubicación', value: (plant) => text(plant.location) },
  { header: 'Apodo', value: (plant) => text(plant.nickname) },
  {
    header: 'Color de flor',
    value: (plant) =>
      plant.flowerColor === null ? '' : FLOWER_COLOR_LABEL[plant.flowerColor],
  },
  {
    // Vacío si la planta no tiene foto.
    header: 'Foto en floración',
    value: (plant) =>
      plant.photoPath === null ? '' : plant.photoInBloom ? 'Sí' : 'No',
  },
  {
    header: 'Fecha de registro',
    value: (plant) => registeredOn(plant.createdAt),
  },
]

// La fecha de alta es un instante con zona: se exporta el día que veía el
// usuario en su dispositivo, como la de adquisición.
function registeredOn(createdAt: string): string {
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime()) ? '' : localDateString(date)
}

const FORMULA_START = /^\s*[=+\-@]|^[\t\r]/

/** Antepone un apóstrofo a lo que una hoja de cálculo tomaría por fórmula. */
export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value
}

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/

/** Una celda lista para el archivo: neutralizada y escapada. */
export function csvCell(value: string): string {
  const safe = neutralizeFormula(value)
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

function csvRow(values: readonly string[]): string {
  return values.map(csvCell).join(SEPARATOR)
}

/** Las plantas en el orden del archivo: por género y por nombre. */
export function exportOrder(
  plants: readonly CollectionPlant[],
): CollectionPlant[] {
  return groupByGenus(plants, { includeInactive: true }).flatMap(
    (group) => group.plants,
  )
}

/**
 * Texto completo del CSV: marca de orden de bytes, cabecera y una fila por
 * planta (todas, también las dadas de baja), cada línea terminada en CRLF.
 */
export function inventoryCsv(plants: readonly CollectionPlant[]): string {
  const lines = [
    csvRow(CSV_COLUMNS.map((column) => column.header)),
    ...exportOrder(plants).map((plant) =>
      csvRow(CSV_COLUMNS.map((column) => column.value(plant))),
    ),
  ]
  return BOM + lines.join(LINE_END) + LINE_END
}

/** Nombre del archivo con la fecha local: "orki-inventario-2026-11-21.csv". */
export function exportFileName(date: Date = new Date()): string {
  return `orki-inventario-${localDateString(date)}.csv`
}
