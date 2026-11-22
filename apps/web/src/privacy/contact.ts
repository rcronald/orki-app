// Medio de contacto de la página de privacidad (#111).
//
// El correo lo indicó el responsable del proyecto. Si se deja el marcador (o
// vacío), la página no lo muestra: dice que el contacto aún no está publicado.

/** Marcador de «sin contacto todavía». */
export const PRIVACY_CONTACT_PLACEHOLDER = 'CONTACTO_PENDIENTE'

/** Medio de contacto: un correo o una URL. */
export const PRIVACY_CONTACT: string = 'rcronald@gmail.com'

/** ¿Falta aún el contacto real? */
export function isPrivacyContactPending(
  contact: string = PRIVACY_CONTACT,
): boolean {
  return contact.trim() === '' || contact === PRIVACY_CONTACT_PLACEHOLDER
}

/** Enlace del contacto: mailto: para un correo, la URL tal cual si es una. */
export function privacyContactHref(contact: string = PRIVACY_CONTACT): string {
  return contact.includes('@') && !contact.includes('://')
    ? `mailto:${contact}`
    : contact
}
