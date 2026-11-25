import { ActionList, ActionRow } from '../components/ui/ActionRow.tsx'
import { Avatar } from '../components/ui/Avatar.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Panel } from '../components/ui/Panel.tsx'
import { ProfileSummary } from '../components/ui/ProfileSummary.tsx'
import { privacyLinkProps } from '../routes/text-page-origin.ts'
import samplePhoto from './foto-muestra.svg'
import { Example, Section } from './layout.tsx'

// Piezas de «Tu cuenta» (#213): avatar, datos del perfil, sección con borde,
// filas de acción, sección de peligro y botón de peligro con borde. Datos
// ficticios.
export function AccountPiecesSection() {
  const privacy = privacyLinkProps('cuenta')
  return (
    <Section
      id="cuenta-piezas"
      title="Tu cuenta: piezas"
      description="Piezas del rediseño de «Tu cuenta» (#213). Los títulos de las secciones son h3 aquí; en la pantalla, h2."
    >
      <Example
        title="Avatar"
        description="Foto redonda; sin foto, iniciales sobre color-neutral-50; sin nombre, el icono user. Dos tamaños: barra (36 px) y perfil (96 px)."
      >
        <div className="flex flex-wrap items-center gap-space-4">
          <Avatar name="Ana López" imageUrl={samplePhoto} />
          <Avatar name="Ana López" />
          <Avatar />
          <Avatar name="Ana López" imageUrl={samplePhoto} size="lg" />
          <Avatar name="Ana López" size="lg" />
          <Avatar size="lg" />
        </div>
      </Example>
      <Example
        title="Sección con borde (Panel) y datos del perfil (ProfileSummary)"
        description="Borde fino, radius-lg, sin fondo ni sombra. «Editar perfil» a la derecha; debajo y a todo el ancho hasta 720 px."
      >
        <Panel title="Perfil" headingLevel={3}>
          <ProfileSummary
            name="Ana López"
            email="ana@example.com"
            action={<Button>Editar perfil</Button>}
          />
        </Panel>
        <Panel title="Perfil sin nombre" headingLevel={3}>
          <ProfileSummary
            email="ana@example.com"
            action={<Button>Editar perfil</Button>}
          />
        </Panel>
      </Example>
      <Example
        title="Filas de acción (ActionList y ActionRow)"
        description="Icono, título, texto secundario y chevron-right; enlace o botón; línea entre filas; área táctil de todo el ancho. Deshabilitada, con el motivo en lugar del texto."
      >
        <Panel title="Datos y privacidad" headingLevel={3}>
          <ActionList>
            <li>
              <ActionRow
                icon="file"
                title="Exportar tu colección a CSV"
                description="El archivo CSV no incluye las fotos."
                onClick={() => {}}
              />
            </li>
            <li>
              <ActionRow
                icon="shield"
                title="Aviso de privacidad"
                description="Consulta qué datos guardamos y quién puede verlos."
                to={privacy.to}
                state={privacy.state}
              />
            </li>
            <li>
              <ActionRow
                icon="user"
                title="Editar perfil"
                disabledReason="Necesitas conexión para editar tu perfil."
              />
            </li>
          </ActionList>
        </Panel>
      </Example>
      <Example
        title="Sección de peligro (Panel tone «danger») y botón con borde"
        description="Borde color-danger, fondo color-danger-soft y título en color-danger. El botón con borde (danger-outline) abre la confirmación; el relleno (danger) queda para la confirmación final."
      >
        <Panel title="Eliminar cuenta" tone="danger" headingLevel={3}>
          <p className="orki-panel__text">
            Se eliminarán tu cuenta, tus plantas y sus fotos. Esta acción es
            irreversible.
          </p>
          <div className="flex flex-wrap gap-space-3">
            <Button variant="danger-outline">Eliminar mi cuenta</Button>
            <Button variant="danger">Eliminar mi cuenta definitivamente</Button>
          </div>
        </Panel>
      </Example>
    </Section>
  )
}
