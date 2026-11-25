import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '../components/ui/Icon.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import { StatusBadge } from '../components/ui/StatusBadge.tsx'
import { PATHS, plantDetailPath } from '../routes/paths.ts'
import type { RegisteredPlant } from './registered-plant.ts'

interface RegisteredNoticeProps {
  plant: RegisteredPlant
  onDismiss: () => void
}

/**
 * Aviso de confirmación tras registrar una planta, sobre el inventario, con
 * su etiqueta de validación ("Validada" o "Nombre por validar", #12), «Ver
 * ficha» del ejemplar recién creado (#296) y «Registrar otra», para quien
 * carga varias plantas.
 *
 * - Las dos acciones son secundarias: la principal de «Mi colección» es
 *   «Registrar orquídea», en la cabecera (una sola por pantalla). «Ver ficha»
 *   va primero: es lo propio de este aviso.
 * - El texto pide al menos 240 px: si no caben a su lado, las acciones bajan
 *   a otra línea en vez de aplastarlo (celular, #261), y entre ellas también.
 *   «Cerrar el aviso» queda siempre arriba a la derecha, en su columna.
 * - La región role="status" se pinta vacía y el texto llega en el pintado
 *   siguiente: un lector de pantalla anuncia un cambio dentro de una región
 *   ya presente, no una región que aparece con su contenido.
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
        <div className="flex items-start gap-space-2 rounded-lg bg-neutral-50 p-space-4">
          <div className="flex min-w-[0] flex-1 flex-wrap items-center gap-space-3">
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
            <div className="flex flex-wrap gap-space-2">
              <Link
                to={plantDetailPath(plant.id)}
                className="orki-btn orki-btn--secondary"
              >
                Ver la planta
                <Icon name="arrow-right" />
              </Link>
              <Link
                to={PATHS.newPlant}
                className="orki-btn orki-btn--secondary"
              >
                <Icon name="plus" />
                Registrar otra
              </Link>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cerrar el aviso"
            className="inline-flex size-[44px] flex-none items-center justify-center rounded-md text-neutral-900 hover:bg-neutral-0"
            onClick={onDismiss}
          >
            <Icon name="x" className="size-[20px]" />
          </button>
        </div>
      )}
    </div>
  )
}
