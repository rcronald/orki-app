import { useState, type ReactNode } from 'react'
import {
  REFERENCE_LABEL,
  REFERENCE_LICENSES,
  referenceAlt,
  type ReferenceCredit,
  type ReferenceImage,
  type ReferencePicture,
} from '../../lib/referencePhotos.ts'

// Foto de referencia de una especie (#234): una foto de iNaturalist que
// enseña cómo es la especie, nunca una foto de la planta de nadie. Siempre va
// rotulada «Foto de referencia» y con su crédito a la vista: el autor, la
// licencia (enlace a su texto legal), «reducida» si la imagen está adaptada y
// el enlace a la foto original. Ver «Foto de referencia» en
// docs/piezas-de-interfaz.md.
//
// - La imagen lleva su ancho y su alto (no mueve la página al llegar), se
//   pide perezosa (loading="lazy", decoding="async") y sin Referer.
// - Si no carga (sin conexión, archivo retirado), la pieza desaparece entera
//   (o pinta `fallback`): nunca un hueco de imagen rota.
// - Sin CSS propio: se compone con utilidades y la píldora orki-gallery__count.

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      rel="noopener noreferrer"
      target="_blank"
      className="text-secondary-strong underline underline-offset-[3px]"
    >
      {children}
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  )
}

/**
 * El crédito de la foto, en una frase con sus enlaces: «Foto: Ana Pérez,
 * CC BY 4.0, reducida. Ver el original en iNaturalist.»
 */
export function ReferenceCreditText({
  credit,
  className = 'text-sm text-neutral-700 [overflow-wrap:anywhere]',
}: {
  credit: ReferenceCredit
  className?: string
}) {
  const license = REFERENCE_LICENSES[credit.license]
  return (
    <p className={className}>
      Foto: {credit.author},{' '}
      <External href={license.url}>{license.label}</External>
      {credit.modified ? ', reducida' : ''}.{' '}
      <External href={credit.sourceUrl}>
        Ver el original en <span lang="en">iNaturalist</span>
      </External>
      .
    </p>
  )
}

/** Una imagen que se quita sola si no carga. */
function useImageFailure(src: string) {
  const [failed, setFailed] = useState<string | null>(null)
  return { failed: failed === src, fail: () => setFailed(src) }
}

export interface ReferencePhotoProps {
  picture: ReferencePicture
  scientificName: string
  /**
   * figure (por defecto): la imagen arriba (la media, o la miniatura si no
   * hay media) con el rótulo encima y el crédito debajo. viewer: lo mismo
   * dentro del recuadro 4:3 de la galería del detalle (orki-viewer__main).
   * compact: la miniatura a la izquierda y el texto a la derecha (registro).
   */
  variant?: 'figure' | 'viewer' | 'compact'
  /** Título del bloque compacto («Así es su especie»). */
  title?: ReactNode
  /** Lo que se pinta si la imagen no carga; por defecto, nada. */
  fallback?: ReactNode
  className?: string
}

export function ReferencePhoto({
  picture,
  scientificName,
  variant = 'figure',
  title,
  fallback = null,
  className,
}: ReferencePhotoProps) {
  const file: ReferenceImage =
    variant === 'compact'
      ? picture.thumbnail
      : (picture.medium ?? picture.thumbnail)
  const { failed, fail } = useImageFailure(file.src)
  if (failed) return <>{fallback}</>

  const img = (classes: string) => (
    <img
      src={file.src}
      width={file.width}
      height={file.height}
      alt={referenceAlt(scientificName)}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={fail}
      className={classes}
    />
  )
  const label = (
    <span className="orki-gallery__count absolute left-space-2 top-space-2">
      {REFERENCE_LABEL}
    </span>
  )
  const classes = (base: string) => [base, className].filter(Boolean).join(' ')

  if (variant === 'compact') {
    return (
      <figure
        className={classes(
          'flex items-start gap-space-3 rounded-lg bg-neutral-50 p-space-3',
        )}
      >
        {img('size-[88px] flex-none rounded-md object-cover')}
        <figcaption className="flex min-w-[0] flex-col gap-space-1">
          {title && (
            <span className="text-md font-semibold text-neutral-900">
              {title}
            </span>
          )}
          <span className="text-sm font-semibold text-secondary-strong">
            {REFERENCE_LABEL}
          </span>
          <ReferenceCreditText credit={picture.credit} />
        </figcaption>
      </figure>
    )
  }

  return (
    <figure className={classes('flex flex-col gap-space-2')}>
      {variant === 'viewer' ? (
        <div className="orki-viewer__main">
          {img('orki-viewer__photo')}
          {label}
        </div>
      ) : (
        <div className="relative max-w-[480px] overflow-hidden rounded-lg bg-neutral-50">
          {img('block h-auto w-full')}
          {label}
        </div>
      )}
      <figcaption>
        <span className="sr-only">{REFERENCE_LABEL}. </span>
        <ReferenceCreditText credit={picture.credit} />
      </figcaption>
    </figure>
  )
}

/**
 * Miniatura de una fila de las listas del catálogo: 44 px, recortada y
 * decorativa (el crédito va en el texto de la fila). Sin miniatura (o si no
 * carga), un hueco del mismo tamaño cuando `reserve`, para que los nombres de
 * la lista sigan alineados.
 */
export function ReferenceThumb({
  image,
  reserve,
}: {
  image: ReferenceImage | null
  reserve: boolean
}) {
  const { failed, fail } = useImageFailure(image?.src ?? '')
  const hole = reserve ? (
    <span
      aria-hidden="true"
      className="size-[44px] flex-none rounded-md bg-neutral-50"
    />
  ) : null
  if (image === null || failed) return hole
  return (
    <img
      src={image.src}
      width={image.width}
      height={image.height}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={fail}
      className="size-[44px] flex-none rounded-md bg-neutral-50 object-cover"
    />
  )
}
