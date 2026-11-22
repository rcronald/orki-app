import type { ReactNode } from 'react'
import { Avatar } from './Avatar.tsx'

export interface ProfileSummaryProps {
  /** Nombre de la cuenta; sin él, el correo hace de identificación. */
  name?: string | null
  email?: string | null
  imageUrl?: string | null
  /**
   * Acción junto a los datos («Editar perfil», un Button secundario): a la
   * derecha en escritorio y debajo, a todo el ancho, hasta 720 px.
   */
  action?: ReactNode
}

// Datos de la cuenta (orki-profile, #213): avatar grande, el nombre en
// negrita y el correo debajo. Sin nombre, el correo ocupa el lugar del nombre
// y el avatar muestra el icono user. Sin nombre ni correo (sesión sin
// confirmar), solo el avatar neutro y la acción.
export function ProfileSummary({
  name,
  email,
  imageUrl,
  action,
}: ProfileSummaryProps) {
  const hasName = name != null && name.trim() !== ''
  const primary = hasName ? name : email
  return (
    <div className="orki-profile">
      <Avatar name={name} imageUrl={imageUrl} size="lg" />
      <div className="orki-profile__text">
        {primary != null && primary !== '' && (
          <p className="orki-profile__name">{primary}</p>
        )}
        {hasName && email != null && email !== '' && (
          <p className="orki-profile__email">{email}</p>
        )}
      </div>
      {action}
    </div>
  )
}
