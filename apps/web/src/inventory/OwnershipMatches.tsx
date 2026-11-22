import { Link } from 'react-router'
import { PLANT_STATUS_LABEL } from '../collection/labels.ts'
import type { Ownership, OwnershipMatch } from '../collection/ownership.ts'
import { Icon } from '../components/ui/Icon.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import { newPlantPathWithName } from '../registration/prefill-name.ts'
import { plantDetailPath } from '../routes/paths.ts'
import { OWNERSHIP_TEXT } from './texts.ts'

// Piezas de "¿Ya la tengo?" que comparten la pantalla propia (#209) y el panel
// del inventario (OwnershipPanel): la lista de ejemplares que coinciden, con
// enlace a su detalle, y el acceso a registrar lo buscado.

/** Texto del estado de validación que se añade a cada ejemplar, si aplica. */
const PENDING_LABEL = 'Nombre por validar'

interface MatchListProps {
  ownership: Ownership
  /** Cuántos se listan; el resto, "Y N más". */
  limit: number
  /** Si se dice de cada ejemplar que su nombre está por validar. */
  showValidation?: boolean
  /** Estado de navegación con el que se abre el detalle. */
  linkState?: unknown
}

/**
 * Ejemplares activos que coinciden o, si no hay ninguno, los que tuvo. Fuera
 * de la región de estado: no se leen en cada pulsación.
 */
export function MatchList({
  ownership,
  limit,
  showValidation = false,
  linkState,
}: MatchListProps) {
  const current = ownership.matches.length > 0
  const list = current ? ownership.matches : ownership.pastMatches
  if (list.length === 0) return null
  const shown = list.slice(0, limit)
  const rest = list.length - shown.length
  return (
    <div className="flex flex-col gap-space-1">
      <ul
        aria-label={
          current ? OWNERSHIP_TEXT.matchesLabel : OWNERSHIP_TEXT.pastLabel
        }
        className="flex flex-col"
      >
        {shown.map((match) => (
          <li key={match.plant.id}>
            <MatchLink
              match={match}
              past={!current}
              showValidation={showValidation}
              linkState={linkState}
            />
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <p className="text-sm text-neutral-700">{OWNERSHIP_TEXT.more(rest)}</p>
      )}
    </div>
  )
}

function matchedByText(match: OwnershipMatch): string | null {
  const { kind, matchedName, plant } = match
  if (kind === 'scientific' || kind === 'genus') return null
  if (kind === 'entered' && matchedName === plant.displayName) return null
  return OWNERSHIP_TEXT.matchedBy[kind](matchedName)
}

// Un ejemplar que coincidió, con enlace a su detalle: el nombre que se
// muestra, por qué nombre coincidió si es otro, el apodo, si su nombre está
// por validar y, si ya no está, su estado. 44 px de alto como mínimo (zona
// táctil).
function MatchLink({
  match,
  past,
  showValidation,
  linkState,
}: {
  match: OwnershipMatch
  past: boolean
  showValidation: boolean
  linkState: unknown
}) {
  const { plant } = match
  const details = [
    matchedByText(match),
    plant.nickname,
    showValidation && plant.validation === 'pending' ? PENDING_LABEL : null,
    past ? PLANT_STATUS_LABEL[plant.status] : null,
  ].filter((detail): detail is string => detail !== null && detail !== '')
  return (
    <Link
      to={plantDetailPath(plant.id)}
      state={linkState}
      className="flex min-h-[44px] flex-col justify-center rounded-md px-space-2 py-space-1 text-md text-neutral-900 hover:bg-neutral-50"
    >
      <span className="[overflow-wrap:anywhere] text-secondary underline">
        {plant.displayNameIsScientific ? (
          <span className="font-display italic">
            <ScientificName name={plant.displayName} />
          </span>
        ) : (
          plant.displayName
        )}
      </span>
      {details.length > 0 && (
        <span className="text-sm text-neutral-700 [overflow-wrap:anywhere]">
          {details.join(' · ')}
        </span>
      )}
    </Link>
  )
}

interface RegisterActionProps {
  ownership: Ownership
  /** Nombre con el que se abre el registro. */
  name: string
  /**
   * Sin conexión (#18): id del texto con el motivo. Con él, el acceso se ve
   * desactivado y lo cita.
   */
  disabledBy?: string
}

/**
 * Registrar lo buscado: principal si no la tiene ("Registrarla con este
 * nombre"); secundario si la tiene o tiene parecidas ("No es la misma:
 * registrarla"). Nada si la tiene con coincidencias exactas o por prefijo.
 */
export function RegisterAction({
  ownership,
  name,
  disabledBy,
}: RegisterActionProps) {
  if (ownership.outcome === 'owned') return null
  const classes = `orki-btn self-start ${
    ownership.outcome === 'not-owned'
      ? 'orki-btn--primary'
      : 'orki-btn--secondary'
  }`
  const text =
    ownership.outcome === 'not-owned'
      ? OWNERSHIP_TEXT.register
      : OWNERSHIP_TEXT.registerAnyway
  return disabledBy === undefined ? (
    <Link to={newPlantPathWithName(name)} className={classes}>
      <Icon name="plus" />
      {text}
    </Link>
  ) : (
    <button
      type="button"
      aria-disabled="true"
      aria-describedby={disabledBy}
      className={classes}
    >
      <Icon name="plus" />
      {text}
    </button>
  )
}
