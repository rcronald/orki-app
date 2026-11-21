import type { PlantType } from '../lib/database.ts'

// Textos del detalle de un ejemplar (#16), en un solo sitio.

export const DETAIL_TEXT = {
  back: 'Volver a mi colección',
  loadingTitle: 'Cargando la planta…',
  loading: 'Cargando los datos de la planta…',
  errorTitle: 'No se pudo cargar la planta',
  notFoundTitle: 'Planta no encontrada',
  notFound:
    'Esta planta no está en tu colección. Puede que la dirección esté mal o que se haya eliminado.',
  dataLabel: 'Datos de la planta',
  enteredName: 'Nombre ingresado',
  genus: 'Género',
  type: 'Tipo',
  validation: 'Nombre',
  status: 'Estado',
  acquiredOn: 'Fecha de adquisición',
  origin: 'Origen',
  location: 'Ubicación',
  nickname: 'Apodo',
  flowerColor: 'Color de la flor',
  photoInBloom: 'Foto en floración',
  yes: 'Sí',
  no: 'No',
  missing: 'Sin indicar',
  /** Explica la etiqueta "Nombre por validar" de una planta no identificable. */
  unidentifiable:
    'No se pudo confirmar el nombre de esta planta con el catálogo: queda con el nombre que escribiste.',
  photoAlt: (name: string) => `Foto de ${name}`,
  photoLoading: (name: string) => `Foto de ${name}: cargando`,
  photoFailed: (name: string) => `Foto de ${name}: no se pudo cargar`,
  noPhoto: 'Sin foto',
  actionsLabel: 'Acciones',
  edit: 'Editar',
  retire: 'Dar de baja',
  reactivate: 'Reactivar',
  delete: 'Eliminar',
  offline:
    'Sin conexión: editar, dar de baja o eliminar necesitan conexión. Las acciones se activarán solas cuando vuelva.',
} as const

/** Tipo de la planta en el detalle; "No sé" del registro se lee "Sin determinar". */
export const DETAIL_TYPE_LABEL = {
  species: 'Especie',
  hybrid: 'Híbrido',
  unknown: 'Sin determinar',
} as const satisfies Record<PlantType, string>
