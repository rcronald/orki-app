// Medio de contacto de la página de privacidad (#111).
//
// PENDIENTE: una persona debe sustituir el marcador por un medio de contacto
// real (por ejemplo un correo que alguien lea) antes de publicar la página.
// No se inventa ninguno. Mientras sea el marcador, la página no lo muestra:
// dice que el contacto aún no está publicado.

/** Marcador único; buscar CONTACTO_PENDIENTE en el repositorio para completarlo. */
export const PRIVACY_CONTACT_PLACEHOLDER = 'CONTACTO_PENDIENTE'

/** Medio de contacto. Sustituir el valor por el real (correo o URL). */
export const PRIVACY_CONTACT: string = PRIVACY_CONTACT_PLACEHOLDER

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
