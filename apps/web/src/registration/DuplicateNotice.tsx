import type { CollectionPlant } from '../collection/model.ts'
import { Icon } from '../components/ui/Icon.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import { countActiveSpecimens } from './duplicates.ts'
import type { FormSpecies } from './form-state.ts'
import { PLANT_FORM_TEXT } from './texts.ts'

interface DuplicateNoticeProps {
  /** Especie enlazada en el nombre; sin ella no hay aviso. */
  species: FormSpecies | null
  /** Plantas del usuario ya cargadas; null si aún no están (sin aviso). */
  knownPlants: readonly CollectionPlant[] | null
}

/**
 * "Ya tienes N ejemplares de …" bajo el nombre (#88), antes de guardar. No
 * bloquea: solo informa. La región role="status" está siempre montada y
 * vacía si no hay aviso, para que el lector de pantalla lo anuncie al
 * aparecer sin mover el foco (que sigue en el nombre). No usa
 * OwnershipAnswer: esa es la respuesta grande de "¿Ya la tengo?", con su
 * propio título y su región, que no se puede dejar montada vacía.
 *
 * Si la colección aún no se cargó o no se pudo cargar, no hay aviso: el
 * formulario no espera por él. Si llega después, aparece entonces.
 */
export function DuplicateNotice({
  species,
  knownPlants,
}: DuplicateNoticeProps) {
  const count =
    species !== null && knownPlants !== null
      ? countActiveSpecimens(knownPlants, species.id)
      : 0

  return (
    <div role="status">
      {species !== null && count > 0 && (
        <p className="mt-space-2 flex items-start gap-space-2 rounded-lg bg-neutral-50 p-space-3 text-sm text-neutral-900">
          <Icon name="check" className="mt-[2px] size-[16px] flex-none" />
          <span className="[overflow-wrap:anywhere]">
            {PLANT_FORM_TEXT.duplicateBefore(count)}
            <em className="font-display">
              <ScientificName name={species.scientificName} />
            </em>
            {PLANT_FORM_TEXT.duplicateAfter}
          </span>
        </p>
      )}
    </div>
  )
}
