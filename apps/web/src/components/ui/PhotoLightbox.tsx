import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react'
import { Icon } from './Icon.tsx'
import { Modal } from './Modal.tsx'

export interface PhotoLightboxProps {
  /** Título del diálogo (su nombre accesible): «Fotos de Phalaenopsis amabilis». */
  title: string
  /** Cuántas fotos hay. */
  count: number
  /** La que se ve, desde 0. */
  index: number
  onIndexChange: (index: number) => void
  /** Escape, «Cerrar» o el gesto de cerrar. */
  onClose: () => void
  /** La imagen de la foto `index` (un <img className="orki-lightbox__photo">). */
  children: ReactNode
  /** Texto bajo la foto (fecha y nota), si lo hay. */
  caption?: ReactNode
}

/** Desplazamiento horizontal mínimo de un deslizamiento, en px. */
const SWIPE_DISTANCE = 48

/** «Foto 2 de 4». */
function lightboxCounter(index: number, count: number): string {
  return `Foto ${String(index + 1)} de ${String(count)}`
}

/**
 * Visor de fotos a pantalla completa (orki-lightbox, #183), sobre Modal: el
 * foco entra (en «Cerrar») y queda atrapado, Escape cierra y el foco vuelve a
 * lo que lo abrió. Con más de una foto, «Foto anterior» y «Foto siguiente»
 * (también las flechas del teclado y deslizar con el dedo); en los extremos
 * quedan con aria-disabled, sin dar la vuelta. El contador «Foto 2 de 4» se
 * anuncia al cambiar. No sabe de dónde salen las imágenes: quien lo usa pasa
 * la de la foto actual (y decide cuándo descargarla).
 */
export function PhotoLightbox({
  title,
  count,
  index,
  onIndexChange,
  onClose,
  children,
  caption,
}: PhotoLightboxProps) {
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null)
  const hasPrevious = index > 0
  const hasNext = index < count - 1

  const go = (offset: -1 | 1) => {
    const next = index + offset
    if (next >= 0 && next < count) onIndexChange(next)
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.metaKey) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    go(event.key === 'ArrowLeft' ? -1 : 1)
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event)
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [])

  return (
    <Modal
      title={title}
      onCancel={onClose}
      overlayClassName="orki-lightbox"
      panelClassName="orki-lightbox__panel"
      titleClassName="orki-lightbox__title"
    >
      <p className="orki-lightbox__count" aria-live="polite">
        {lightboxCounter(index, count)}
      </p>
      <button
        type="button"
        className="orki-lightbox__close"
        aria-label="Cerrar"
        onClick={onClose}
      >
        <Icon name="x" />
      </button>
      <div
        className="orki-lightbox__stage"
        onPointerDown={(event) => {
          if (event.pointerType !== 'touch') return
          swipe.current = {
            x: event.clientX,
            y: event.clientY,
            id: event.pointerId,
          }
        }}
        onPointerUp={(event) => {
          const start = swipe.current
          swipe.current = null
          if (!start || start.id !== event.pointerId) return
          const dx = event.clientX - start.x
          const dy = event.clientY - start.y
          if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy)) {
            return
          }
          go(dx > 0 ? -1 : 1)
        }}
        onPointerCancel={() => {
          swipe.current = null
        }}
      >
        {children}
        {count > 1 && (
          <>
            <button
              type="button"
              className="orki-lightbox__nav orki-lightbox__nav--previous"
              aria-label="Foto anterior"
              aria-disabled={!hasPrevious || undefined}
              onClick={() => go(-1)}
            >
              <Icon name="arrow-left" />
            </button>
            <button
              type="button"
              className="orki-lightbox__nav orki-lightbox__nav--next"
              aria-label="Foto siguiente"
              aria-disabled={!hasNext || undefined}
              onClick={() => go(1)}
            >
              <Icon name="arrow-right" />
            </button>
          </>
        )}
      </div>
      {caption ? <div className="orki-lightbox__caption">{caption}</div> : null}
    </Modal>
  )
}
