import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '../components/ui/Icon.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import { StatusBadge } from '../components/ui/StatusBadge.tsx'
import { PATHS } from '../routes/paths.ts'
import type { RegisteredPlant } from './registered-plant.ts'

interface RegisteredNoticeProps {
  plant: RegisteredPlant
  onDismiss: () => void
}

/**
 * Aviso de confirmación tras registrar una planta, sobre el inventario, con
 * su etiqueta de validación ("Validada" o "Nombre por validar", #12) y
 * "Registrar otra". El texto pide al menos 240 px: si no caben a su lado, las
 * acciones bajan a otra línea en vez de aplastarlo (celular). La región role="status" se pinta vacía y el texto llega
 * en el pintado siguiente: un lector de pantalla anuncia un cambio dentro de
 * una región ya presente, no una región que aparece con su contenido.
 */
export function RegisteredNotice({ plant, onDismiss }: RegisteredNoticeProps) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div role="status">
      {visible && (
        <div className="flex flex-wrap items-center gap-space-3 rounded-lg bg-neutral-50 p-space-4">
          <p className="flex min-w-[0] flex-[1_1_240px] items-start gap-space-2 text-md text-neutral-900">
            <Icon
              name="circle-check"
              className="mt-[2px] size-[20px] flex-none text-success"
            />
            <span className="min-w-[0] break-words">
              Registraste{' '}
              {plant.scientific ? (
                <span className="font-display italic">
                  <ScientificName name={plant.name} />
                </span>
              ) : (
                <span className="font-semibold">{plant.name}</span>
              )}{' '}
              en tu colección.
              {plant.status && (
                <>
                  {' '}
                  <StatusBadge
                    status={plant.status}
                    className="align-middle whitespace-nowrap"
                  />
                </>
              )}
            </span>
          </p>
          <div className="flex items-center gap-space-2">
            <Link to={PATHS.newPlant} className="orki-btn orki-btn--secondary">
              <Icon name="plus" />
              Registrar otra
            </Link>
            <button
              type="button"
              aria-label="Cerrar el aviso"
              className="inline-flex size-[44px] items-center justify-center rounded-md text-neutral-900 hover:bg-neutral-0"
              onClick={onDismiss}
            >
              <Icon name="x" className="size-[20px]" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
