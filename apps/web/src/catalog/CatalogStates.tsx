import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Button } from '../components/ui/Button.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { QueryAnswer } from '../components/ui/QueryAnswer.tsx'
import { catalogHomePath } from './paths.ts'
import { CATALOG_TEXT } from './texts.ts'
import type { CatalogFailure } from './useCatalogData.ts'

// Estados de las pantallas del catálogo (#232): cargando, error con
// «Reintentar» (distinto sin conexión) y «no encontrado» con la vuelta al
// catálogo. Cada uno es su propia región role="status".

export function CatalogLoading({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="text-md text-neutral-700">
      {children}
    </p>
  )
}

/**
 * No se pudo leer: sin conexión, el catálogo no está en el dispositivo y se
 * dice así (lo ya visto en la visita se sigue viendo, ver useCatalogData);
 * con conexión, un fallo del servidor o de la red. Los dos con «Reintentar».
 */
export function CatalogError({
  reason,
  onRetry,
}: {
  reason: CatalogFailure
  onRetry: () => void
}) {
  const offline = reason === 'offline'
  return (
    <QueryAnswer
      tone="notice"
      icon={offline ? 'cloud-off' : 'triangle-alert'}
      title={offline ? CATALOG_TEXT.offlineTitle : CATALOG_TEXT.failedTitle}
      action={
        <Button
          variant="secondary"
          className="orki-answer__action"
          onClick={onRetry}
        >
          {CATALOG_TEXT.retry}
        </Button>
      }
    >
      <p className="orki-answer__text">
        {offline ? CATALOG_TEXT.offlineText : CATALOG_TEXT.failedText}
      </p>
    </QueryAnswer>
  )
}

/** Enlace «Volver al catálogo», para la cabecera de las pantallas hijas. */
export function BackToCatalog({ letter }: { letter?: string | null }) {
  return (
    <Link
      to={catalogHomePath(letter)}
      className="orki-link orki-pagehead__back"
    >
      <Icon name="arrow-left" />
      {CATALOG_TEXT.back}
    </Link>
  )
}

/** Un género o una especie que no existe o no es pública. */
export function CatalogNotFound({ text }: { text: string }) {
  return (
    <div role="status" className="flex flex-col items-start gap-space-4">
      <p className="text-md text-neutral-900">{text}</p>
      <Link to={catalogHomePath()} className="orki-btn orki-btn--primary">
        <Icon name="arrow-left" />
        {CATALOG_TEXT.back}
      </Link>
    </div>
  )
}
