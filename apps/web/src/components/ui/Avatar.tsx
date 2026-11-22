import { useState } from 'react'
import { Icon } from './Icon.tsx'
import { initialsOf } from './initials.ts'

export interface AvatarProps {
  /** Nombre de la cuenta, para las iniciales; null o vacío si no se sabe. */
  name?: string | null
  /** Foto de la cuenta; sin ella (o si no carga), las iniciales. */
  imageUrl?: string | null
  /** sm (por defecto, 36 px): la barra. lg (96 px): el perfil. */
  size?: 'sm' | 'lg'
  className?: string
}

// Avatar del sistema (orki-avatar, #213): círculo con la foto de la cuenta;
// sin foto, las iniciales del nombre en font-display sobre color-neutral-50;
// sin nombre, el icono user. Siempre va junto al nombre o dentro de un botón
// con nombre («Tu cuenta»), así que es decorativo: aria-hidden y alt vacío.
export function Avatar({
  name,
  imageUrl,
  size = 'sm',
  className,
}: AvatarProps) {
  // La foto que falló, para no volver a intentarla y caer en las iniciales.
  const [failed, setFailed] = useState<string | null>(null)
  const initials = initialsOf(name)
  const classes = ['orki-avatar', size === 'lg' && 'orki-avatar--lg', className]
    .filter(Boolean)
    .join(' ')
  const showImage = imageUrl != null && imageUrl !== '' && failed !== imageUrl

  let content
  if (showImage) {
    content = (
      <img
        src={imageUrl}
        alt=""
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(imageUrl)}
      />
    )
  } else if (initials !== '') {
    content = initials
  } else {
    content = <Icon name="user" />
  }

  return (
    <span className={classes} aria-hidden="true" data-avatar="">
      {content}
    </span>
  )
}
