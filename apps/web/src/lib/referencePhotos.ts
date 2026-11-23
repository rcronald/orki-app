import { speciesPhotoLicenses, type SpeciesPhotoLicense } from './database.ts'
import { getSupabase, type OrkiSupabaseClient } from './supabase.ts'

// Fotos de referencia de las especies en la app (#234, parte de #180). Ver
// «Fotos de referencia» en supabase/README.md.
//
// - Las imágenes están en el bucket público species-photos: su dirección es la
//   pública de Storage (getPublicUrl), sin token ni URL firmada, así que la
//   puede pedir cualquiera y la sirve la caché del CDN.
// - Llegan por tres caminos: las funciones del catálogo público
//   (reference_photo en la ficha, reference_thumbnail en la búsqueda y en las
//   especies de un género), la tabla species_photos con sesión (la especie
//   elegida en el registro y el detalle de una planta sin foto propia) y el
//   detalle de una especie del backoffice (embebida). Los tres se convierten
//   aquí en un ReferencePicture con las direcciones ya resueltas.
// - No se guardan en el dispositivo: ni van en el precaché ni en Cache Storage
//   (ver «Sin conexión» en el README). Sin conexión no se piden y, si una
//   imagen no carga, la pieza que la muestra se retira (ReferencePhoto.tsx).
// - Lo que llega se valida: una forma inesperada (una licencia que no es de
//   las aceptadas, una dirección de la foto que no es de iNaturalist) se trata
//   como «sin foto», nunca se muestra una foto sin su atribución.

/** El bucket de las fotos de referencia (público). */
export const REFERENCE_PHOTO_BUCKET = 'species-photos'

/** Una imagen ya resuelta: su dirección pública y su tamaño en píxeles. */
export interface ReferenceImage {
  src: string
  width: number
  height: number
}

/** Lo que hace falta para atribuir la foto (autor, licencia y original). */
export interface ReferenceCredit {
  author: string
  license: SpeciesPhotoLicense
  /** La página de la foto en iNaturalist. */
  sourceUrl: string
  /** Si la imagen guardada está reducida y convertida. */
  modified: boolean
}

/** La foto de referencia de una especie. */
export interface ReferencePicture {
  /** La versión media; null en la búsqueda y en las listas (solo miniatura). */
  medium: ReferenceImage | null
  thumbnail: ReferenceImage
  credit: ReferenceCredit
  /** El id de la foto en iNaturalist (para retirarla desde el backoffice). */
  sourcePhotoId: string
}

/** Nombre y texto legal de cada licencia aceptada (enlaces oficiales de Creative Commons). */
export const REFERENCE_LICENSES: Record<
  SpeciesPhotoLicense,
  { label: string; url: string }
> = {
  cc0: {
    label: 'CC0 1.0',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode.es',
  },
  // La «marca de dominio público» no es una licencia ni tiene texto legal:
  // su página explica qué significa.
  pd: {
    label: 'dominio público',
    url: 'https://creativecommons.org/publicdomain/mark/1.0/deed.es',
  },
  'cc-by': {
    label: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/legalcode.es',
  },
  'cc-by-sa': {
    label: 'CC BY-SA 4.0',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/legalcode.es',
  },
}

/** El rótulo de toda foto de referencia. */
export const REFERENCE_LABEL = 'Foto de referencia'

/** Texto alternativo: «Foto de referencia de Cattleya maxima». */
export function referenceAlt(scientificName: string): string {
  return `${REFERENCE_LABEL} de ${scientificName}`
}

/** El crédito sin enlaces, para una fila que ya es un enlace. */
export function referenceCreditPlain(credit: ReferenceCredit): string {
  return `${REFERENCE_LABEL}: ${credit.author}, ${REFERENCE_LICENSES[credit.license].label}`
}

const SOURCE_URL = /^https:\/\/www\.inaturalist\.org\/photos\/([1-9][0-9]*)$/

type Resolve = (path: string) => string

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function size(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null
}

function image(
  row: Record<string, unknown>,
  prefix: 'medium' | 'thumbnail',
  resolve: Resolve,
): ReferenceImage | null {
  const path = text(row[`${prefix}_path`])
  const width = size(row[`${prefix}_width`])
  const height = size(row[`${prefix}_height`])
  if (path === null || width === null || height === null) return null
  return { src: resolve(path), width, height }
}

/**
 * La foto a partir de una fila de species_photos, del reference_photo de la
 * ficha o del reference_thumbnail de las listas (tienen los mismos nombres de
 * columna). Null si no hay foto o le falta algo para mostrarla con su
 * atribución.
 */
export function toReferencePicture(
  value: unknown,
  resolve: Resolve,
): ReferencePicture | null {
  if (!isRecord(value)) return null
  const thumbnail = image(value, 'thumbnail', resolve)
  const author = text(value.author_name)
  const license = value.license
  const sourceUrl = typeof value.source_url === 'string' ? value.source_url : ''
  const sourcePhotoId = SOURCE_URL.exec(sourceUrl)?.[1]
  if (
    thumbnail === null ||
    author === null ||
    typeof license !== 'string' ||
    !(speciesPhotoLicenses as readonly string[]).includes(license) ||
    sourcePhotoId === undefined ||
    (value.source !== undefined && value.source !== 'inaturalist')
  ) {
    return null
  }
  return {
    medium: image(value, 'medium', resolve),
    thumbnail,
    credit: {
      author,
      license: license as SpeciesPhotoLicense,
      sourceUrl,
      modified: value.is_modified !== false,
    },
    sourcePhotoId,
  }
}

/** Convierte una ruta del bucket en su dirección pública. */
export function publicPhotoUrl(client: OrkiSupabaseClient): Resolve {
  const bucket = client.storage.from(REFERENCE_PHOTO_BUCKET)
  return (path) => bucket.getPublicUrl(path).data.publicUrl
}

/** Columnas de species_photos que usa la app (sin las de la carga). */
export const SPECIES_PHOTO_SELECT =
  'medium_path, medium_width, medium_height, thumbnail_path, thumbnail_width, thumbnail_height, author_name, license, source, source_url, is_modified'

/**
 * La foto de referencia de una especie, con sesión: una consulta por clave a
 * species_photos (/rest/v1/species_photos?species_id=eq.<id>). Null si no
 * tiene. Sin conexión no se pide (null) y cualquier fallo es «sin foto»: es
 * una ayuda, no un dato que falte.
 */
export async function getSpeciesReferencePhoto(
  speciesId: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<ReferencePicture | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return null
  }
  try {
    const client = await getSupabase()
    signal?.throwIfAborted()
    let request = client
      .from('species_photos')
      .select(SPECIES_PHOTO_SELECT)
      .eq('species_id', speciesId)
    if (signal) request = request.abortSignal(signal)
    const { data, error } = await request.maybeSingle()
    if (error || data === null) return null
    return toReferencePicture(data, publicPhotoUrl(client))
  } catch {
    return null
  }
}
