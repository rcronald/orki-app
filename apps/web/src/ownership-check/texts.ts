// Textos de la pantalla «¿Ya la tengo?» (#209). Los del panel del inventario
// que se reutilizan (registrar, "Y N más", "por qué nombre coincidió") siguen
// en inventory/texts.ts (OWNERSHIP_TEXT).

export const CHECK_TEXT = {
  title: '¿Ya la tengo?',
  intro: 'Comprueba si una orquídea ya está en tu colección.',
  back: 'Volver a Mi colección',
  fieldLabel: 'Nombre de la orquídea',
  placeholder: 'Nombre, sinónimo, nombre común o género',
  clear: 'Borrar la consulta',
  loading: 'Cargando tu colección para responder…',
  yes: 'Sí, la tienes',
  similar: 'Tienes parecidas',
  had: 'No, pero la tuviste',
  no: 'Aún no la tienes',
  seeInCollection: 'Ver en mi colección',
  /** Sin datos que consultar por falta de conexión: no es un "no". */
  noCopy: {
    title: 'Sin copia disponible',
    text: 'No hay conexión y este dispositivo aún no guarda una copia de tu colección, así que no se puede comprobar. Cuando vuelvas a tener señal, abre Mi colección una vez: se guardará una copia para consultarla también sin conexión.',
  },
  retry: 'Reintentar',
  /**
   * Un «no» mientras faltan los sinónimos, nombres comunes o abreviaturas de
   * alguna planta (#274): no es seguro.
   */
  unconfirmed: {
    pending: 'Comprobando sinónimos y abreviaturas…',
    unchecked: 'No pudimos comprobarlo todo',
    whenOnline: 'Se comprobará solo al volver la conexión.',
  },
} as const

/** "1 ejemplar", "3 ejemplares". */
export function specimenCountText(count: number): string {
  return count === 1 ? '1 ejemplar' : `${count} ejemplares`
}
