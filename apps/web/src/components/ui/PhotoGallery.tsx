import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button.tsx'
import { galleryPhotoLabel } from './gallery-label.ts'
import { Icon } from './Icon.tsx'

/** Estado de una miniatura de la galería. */
export type GalleryPhotoState =
  /** Elegida y aún sin preparar (reducir y quitar metadatos): sin imagen. */
  | { status: 'preparing' }
  /** Preparada, pendiente de guardar. */
  | { status: 'ready' }
  /** Subiendo; progress de 0 a 1 si se conoce. */
  | { status: 'uploading'; progress?: number }
  /** Ya guardada con la planta. */
  | { status: 'saved' }
  /** No se pudo subir; con onRetry se ofrece «Reintentar». */
  | { status: 'error'; message?: string }

export interface GalleryPhoto {
  /** Clave estable de la foto (no cambia al quitar otras). */
  id: string
  /** Miniatura; sin ella (preparando o cargando), el hueco vacío. */
  src?: string
  state: GalleryPhotoState
}

export interface PhotoGalleryProps {
  /** Fotos en orden: la primera es la principal. */
  photos: readonly GalleryPhoto[]
  /** Máximo de fotos (6). */
  max: number
  /** Título del recuadro: «Fotos». */
  title?: string
  /** Lo que sigue al título en gris: «(opcional)». */
  titleSuffix?: string
  headingLevel?: 2 | 3
  /** Quitar una foto (botón en la esquina de cada miniatura). */
  onRemove?: (id: string) => void
  /** Reintentar la subida de una foto con error. */
  onRetry?: (id: string) => void
  /** «Tomar foto»: abre la cámara. Sin él, no se muestra. */
  onTakePhoto?: () => void
  /** «Elegir fotos»: abre el selector de archivos con selección múltiple. */
  onChoosePhotos: () => void
  /**
   * Sin añadir ni quitar (guardando, sin conexión). Las acciones quedan con
   * aria-disabled y siguen recibiendo el foco; «Reintentar» sigue activo.
   */
  disabled?: boolean
  /** Línea de ayuda bajo las acciones; por defecto, «Puedes añadir hasta 6 fotos.». */
  help?: ReactNode
  /** Aviso bajo el título (nombre por validar); describe el recuadro. */
  notice?: ReactNode
  /** Texto del estado vacío. */
  emptyText?: string
  /** Lo que va al final del recuadro (mensajes, «Deshacer»). */
  children?: ReactNode
  className?: string
}

function stateText(state: GalleryPhotoState): string | null {
  switch (state.status) {
    case 'preparing':
      return 'Preparando…'
    case 'uploading':
      return state.progress === undefined
        ? 'Subiendo…'
        : // Espacio duro antes de «%»: en la franja estrecha del celular, la
          // cifra y su signo no se separan.
          `Subiendo… ${String(Math.round(state.progress * 100))}\u00a0%`
    case 'saved':
      return 'Guardada'
    case 'error':
      return state.message ?? 'No se subió'
    case 'ready':
      return null
  }
}

// Galería de fotos de un formulario (orki-gallery, #220): recuadro con título
// y contador («3 de 6»), cuadrícula de tres columnas con las miniaturas (la
// primera, «Principal»; hasta 720 px, dos columnas y el estado en una franja
// bajo la miniatura para que se lea entero, #247), un botón de quitar en la esquina de cada una (objetivo
// de 44 × 44 px aunque el círculo mida 28) y las acciones «Tomar foto» y
// «Elegir fotos» con su línea de ayuda. Solo pinta: quien la usa guarda las
// fotos, las prepara y las sube.
//
// Accesibilidad: el recuadro es una región con nombre («Fotos»), la cuadrícula
// una lista y cada miniatura una imagen con nombre («Foto principal», «Foto 2
// de 3»), con su estado como texto visible. Llena, las dos acciones quedan con
// aria-disabled y el motivo enlazado (aria-describedby). Al quitar una foto el
// foco pasa al botón de quitar de la que ocupa su lugar, o a la anterior, o a
// «Elegir fotos» si no queda ninguna. Los anuncios («Foto quitada») los hace
// quien la usa en su región role="status".
export function PhotoGallery({
  photos,
  max,
  title = 'Fotos',
  titleSuffix = '(opcional)',
  headingLevel = 2,
  onRemove,
  onRetry,
  onTakePhoto,
  onChoosePhotos,
  disabled = false,
  help,
  notice,
  emptyText = 'Aún no hay fotos.',
  children,
  className,
}: PhotoGalleryProps) {
  const id = useId()
  const titleId = `${id}-titulo`
  const noticeId = `${id}-aviso`
  const helpId = `${id}-ayuda`
  const Heading = `h${headingLevel}` as const
  const full = photos.length >= max
  const blocked = disabled || full
  const removeRefs = useRef(new Map<string, HTMLButtonElement>())
  const fallbackRef = useRef<HTMLButtonElement | null>(null)
  // Posición de la foto quitada, para llevar el foco a la que ocupa su lugar
  // cuando la lista ya cambió.
  const [removedAt, setRemovedAt] = useState<number | null>(null)

  useEffect(() => {
    if (removedAt === null) return
    const next = photos[Math.min(removedAt, photos.length - 1)]
    const target = next ? removeRefs.current.get(next.id) : undefined
    ;(target ?? fallbackRef.current)?.focus()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- el foco se mueve una vez, cuando la lista ya no tiene la foto quitada.
    setRemovedAt(null)
  }, [removedAt, photos])

  const remove = (photo: GalleryPhoto, index: number) => {
    if (disabled || !onRemove) return
    setRemovedAt(index)
    onRemove(photo.id)
  }

  const helpText = full
    ? `Ya tienes ${String(max)} fotos. Quita una para añadir otra.`
    : (help ?? `Puedes añadir hasta ${String(max)} fotos.`)

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={notice ? noticeId : undefined}
      className={['orki-gallery', className].filter(Boolean).join(' ')}
    >
      <div className="orki-gallery__head">
        <Heading id={titleId} className="orki-gallery__title">
          {title}
          {titleSuffix && (
            <>
              {' '}
              <span className="orki-gallery__optional">{titleSuffix}</span>
            </>
          )}
        </Heading>
        <span className="orki-gallery__count">
          {photos.length} de {max}
          <span className="sr-only"> fotos</span>
        </span>
      </div>
      {notice && (
        <p id={noticeId} className="orki-gallery__notice">
          {notice}
        </p>
      )}

      {photos.length === 0 ? (
        <p className="orki-gallery__empty">
          <Icon name="image" />
          {emptyText}
        </p>
      ) : (
        <ul className="orki-gallery__grid" aria-label="Fotos elegidas">
          {photos.map((photo, index) => {
            const label = galleryPhotoLabel(index, photos.length)
            const status = photo.state.status
            const text = stateText(photo.state)
            return (
              <li
                key={photo.id}
                className={`orki-gallery__item orki-gallery__item--${status}`}
              >
                {photo.src ? (
                  <img
                    className="orki-gallery__photo"
                    src={photo.src}
                    alt={label}
                    decoding="async"
                  />
                ) : (
                  <span
                    className="orki-gallery__photo"
                    role="img"
                    aria-label={label}
                  />
                )}
                {/* La etiqueta y el estado van en el mismo borde: con un
                    estado a la vista, la etiqueta se aparta (el nombre
                    accesible ya dice «Foto principal»). */}
                {index === 0 && text === null && (
                  <span className="orki-gallery__badge" aria-hidden="true">
                    Principal
                  </span>
                )}
                {text !== null && (
                  <span className="orki-gallery__state">
                    {status === 'saved' && <Icon name="check" />}
                    {text}
                    {status === 'uploading' &&
                      photo.state.status === 'uploading' &&
                      photo.state.progress !== undefined && (
                        <span className="orki-gallery__bar" aria-hidden="true">
                          <span
                            style={{
                              width: `${String(Math.round(photo.state.progress * 100))}%`,
                            }}
                          />
                        </span>
                      )}
                    {status === 'error' && onRetry && (
                      <button
                        type="button"
                        className="orki-gallery__retry"
                        aria-label={`Reintentar ${label.toLowerCase()}`}
                        onClick={() => onRetry(photo.id)}
                      >
                        Reintentar
                      </button>
                    )}
                  </span>
                )}
                {onRemove && status !== 'uploading' && status !== 'saved' && (
                  <button
                    ref={(element) => {
                      if (element) removeRefs.current.set(photo.id, element)
                      else removeRefs.current.delete(photo.id)
                    }}
                    type="button"
                    className="orki-gallery__remove"
                    aria-label={`Quitar ${label.toLowerCase()}`}
                    aria-disabled={disabled || undefined}
                    onClick={() => remove(photo, index)}
                  >
                    <Icon name="x" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="orki-gallery__actions">
        {onTakePhoto && (
          <Button
            icon="camera"
            aria-disabled={blocked || undefined}
            aria-describedby={full ? helpId : undefined}
            onClick={() => {
              if (!blocked) onTakePhoto()
            }}
          >
            Tomar foto
          </Button>
        )}
        <Button
          ref={fallbackRef}
          icon="image"
          aria-disabled={blocked || undefined}
          aria-describedby={full ? helpId : undefined}
          onClick={() => {
            if (!blocked) onChoosePhotos()
          }}
        >
          Elegir fotos
        </Button>
      </div>
      <p id={helpId} className="orki-gallery__help">
        {helpText}
      </p>
      {children}
    </section>
  )
}
