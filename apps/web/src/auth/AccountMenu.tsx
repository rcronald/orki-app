import { useUser } from '@clerk/react'
import { Avatar } from '../components/ui/Avatar.tsx'
import { MenuButton, type MenuItem } from '../components/ui/MenuButton.tsx'
import { PATHS } from '../routes/paths.ts'
import { useIsCatalogAdmin } from './roles.ts'
import { useAppIdentity } from './useAppIdentity.ts'
import { useSignOutHere } from './useSignOutHere.ts'

const UNVERIFIED_TEXT = {
  offline: 'Sin conexión: tu sesión se confirmará al recuperarla.',
  failed: 'El acceso a tu cuenta no está disponible ahora.',
} as const

// Menú «Tu cuenta» de la barra de la app (#207), en lugar del UserButton de
// Clerk. El botón lleva la foto de la cuenta (o sus iniciales) y «Tu cuenta»,
// que hasta 720 px queda solo para el lector de pantalla. Opciones:
// - «Mi cuenta» (/cuenta): ahí se edita el perfil de Clerk (useProfileEditor,
//   #214), se exporta, se consulta la privacidad y se elimina la cuenta.
// - «Administración», solo con el rol catalog_admin (comodidad de la
//   interfaz; la protección real es la de la base de datos, #6).
// - «Cerrar sesión», con el cierre propio de la app, también sin conexión.
//
// Con la sesión recordada sin confirmar (unverified: sin conexión o sin
// Clerk) no hay datos de Clerk: avatar neutro (icono user), un aviso arriba y
// las opciones que funcionan sin Clerk («Mi cuenta», que se abre en solo
// lectura, y «Cerrar sesión»). Solo se pinta con signed-in o unverified.
export function AccountMenu() {
  const identity = useAppIdentity()
  const { user } = useUser()
  const isAdmin = useIsCatalogAdmin()
  const signOut = useSignOutHere()

  const confirmed = identity.kind === 'signed-in' && user != null
  const name = confirmed ? (user.fullName ?? null) : null
  const email = confirmed
    ? (user.primaryEmailAddress?.emailAddress ?? null)
    : null
  const imageUrl = confirmed && user.hasImage ? user.imageUrl : null

  const items: MenuItem[] = [
    { kind: 'link', label: 'Tu cuenta', icon: 'user', to: PATHS.account },
  ]
  if (isAdmin) {
    items.push({
      kind: 'link',
      label: 'Administración',
      icon: 'settings',
      to: PATHS.catalogAdmin,
    })
  }
  items.push(
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Cerrar sesión',
      icon: 'log-out',
      onSelect: signOut,
    },
  )

  let header = null
  if (identity.kind === 'unverified') {
    header = UNVERIFIED_TEXT[identity.reason]
  } else if (name || email) {
    header = (
      <>
        {name && <strong>{name}</strong>}
        {email}
      </>
    )
  }

  return (
    <MenuButton items={items} header={header}>
      <Avatar name={name} imageUrl={imageUrl} />
      <span className="orki-menu__label">Tu cuenta</span>
    </MenuButton>
  )
}
