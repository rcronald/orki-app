import { useId, useRef, useState, type Ref } from 'react'
import { Icon } from '../components/ui/Icon.tsx'
import { PhotoLightbox } from '../components/ui/PhotoLightbox.tsx'
import { useOnlineStatus } from '../lib/useOnlineStatus.ts'
import { useNearViewport, usePlantImage } from '../photos/usePlantImage.ts'
import {
  formatLogDateTime,
  LOG_TYPE_ICON,
  LOG_TYPE_LABEL,
  type LogEntry,
} from './model.ts'
import { LOG_TEXT } from './texts.ts'

interface LogEntryItemProps {
  entry: LogEntry
  /** El artículo del registro, para llevarle el foco (tras borrar otro). */
  articleRef?: Ref<HTMLElement>
  /** Si se puede borrar: con conexión y la sesión confirmada. */
  canDelete: boolean
  /** id del texto que explica por qué no se puede. */
  reasonId?: string
  onDelete: (entry: LogEntry, trigger: HTMLButtonElement) => void
}

/** La foto completa en el visor; mientras llega (o si falla), la miniatura. */
function ViewerPhoto({ entry, alt }: { entry: LogEntry; alt: string }) {
  const full = usePlantImage(entry.photoPath, 'photo')
  const thumbnail = usePlantImage(entry.thumbnailPath, 'photo')
  const image = full.status === 'ready' ? full : thumbnail
  return image.status === 'ready' ? (
    <img className="orki-lightbox__photo" src={image.src} alt={alt} />
  ) : (
    <span className="orki-lightbox__photo" role="img" aria-label={alt} />
  )
}

/** Miniatura de la foto del registro; al pulsarla, el visor. */
function EntryPhoto({ entry }: { entry: LogEntry }) {
  const button = useRef<HTMLButtonElement>(null)
  const near = useNearViewport(button)
  // Como 'photo': solo en memoria. La bitácora no se guarda en el
  // dispositivo (#263), tampoco sus miniaturas en Cache Storage.
  const thumbnail = usePlantImage(entry.thumbnailPath, 'photo', near)
  const online = useOnlineStatus()
  const [open, setOpen] = useState(false)
  const alt = LOG_TEXT.photoAlt(entry.title)
  return (
    <>
      <button
        ref={button}
        type="button"
        className="orki-viewer__thumb mt-space-2 size-[72px]"
        aria-label={LOG_TEXT.openPhoto(entry.title)}
        onClick={() => setOpen(true)}
      >
        {thumbnail.status === 'ready' ? (
          <img
            src={thumbnail.src}
            alt=""
            className="size-[100%] object-cover"
            width={72}
            height={72}
          />
        ) : thumbnail.status === 'error' ? (
          <span className="orki-viewer__missing size-[100%] justify-center">
            <Icon name="cloud-off" />
            <span className="sr-only">
              {online ? LOG_TEXT.photoUnavailable : null}
            </span>
          </span>
        ) : null}
      </button>
      {open && (
        <PhotoLightbox
          title={alt}
          count={1}
          index={0}
          onIndexChange={() => {}}
          onClose={() => setOpen(false)}
        >
          <ViewerPhoto entry={entry} alt={alt} />
        </PhotoLightbox>
      )}
    </>
  )
}

/**
 * Un registro de la bitácora (#267), como la maqueta «Ficha de la planta»
 * del #263: a la izquierda, el icono del tipo en un círculo; en el centro,
 * el tipo, el título (h3), la descripción, la floración observada y la
 * miniatura de la foto, solo si existen; la fecha y la hora a la derecha en
 * escritorio y debajo hasta 720 px; y «Eliminar» (papelera, 44 px).
 *
 * El artículo admite el foco (tabIndex -1): tras borrar un registro, el foco
 * pasa al siguiente.
 */
export function LogEntryItem({
  entry,
  articleRef,
  canDelete,
  reasonId,
  onDelete,
}: LogEntryItemProps) {
  const titleId = useId()
  return (
    <li>
      <article
        ref={articleRef}
        tabIndex={-1}
        aria-labelledby={titleId}
        className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-start gap-x-space-4 gap-y-space-2 rounded-lg border border-neutral-200 bg-neutral-0 p-space-4 publico-estrecho:grid-cols-[auto_minmax(0,1fr)_auto]"
      >
        <span className="flex size-[48px] items-center justify-center rounded-pill bg-secondary-soft text-secondary-strong [grid-row:1/span_2] [&_svg]:size-[24px]">
          <Icon name={LOG_TYPE_ICON[entry.type]} />
        </span>
        <div className="flex min-w-[0] flex-col gap-space-1 [grid-column:2] [grid-row:1]">
          <p className="text-sm font-semibold text-secondary-strong">
            {LOG_TYPE_LABEL[entry.type]}
          </p>
          <h3
            id={titleId}
            className="text-md font-semibold text-neutral-900 [overflow-wrap:anywhere]"
          >
            {entry.title}
          </h3>
          {entry.description !== null && (
            <p className="whitespace-pre-line text-md text-neutral-700 [overflow-wrap:anywhere]">
              {entry.description}
            </p>
          )}
          {entry.inBloom !== null && (
            <p className="flex items-center gap-space-2 text-sm text-neutral-900 [&_svg]:size-[16px]">
              <Icon name="flower" />
              {LOG_TEXT.bloom(entry.inBloom)}
            </p>
          )}
          {entry.thumbnailPath !== null && <EntryPhoto entry={entry} />}
        </div>
        <p className="flex items-center gap-space-2 pt-[2px] text-md whitespace-nowrap text-neutral-900 [grid-column:3] [grid-row:1] publico-estrecho:text-sm publico-estrecho:text-neutral-700 publico-estrecho:[grid-column:2] publico-estrecho:[grid-row:2] [&_svg]:size-[16px]">
          <Icon name="calendar" />
          <time dateTime={entry.createdAt}>
            {formatLogDateTime(entry.createdAt)}
          </time>
        </p>
        <button
          type="button"
          className="-my-[8px] -mr-[8px] flex size-[44px] cursor-pointer items-center justify-center rounded-md text-neutral-700 [grid-column:4] [grid-row:1] hover:bg-neutral-50 hover:text-danger aria-disabled:cursor-not-allowed aria-disabled:hover:bg-transparent aria-disabled:hover:text-neutral-700 publico-estrecho:[grid-column:3] [&_svg]:size-[20px]"
          aria-label={LOG_TEXT.delete(entry.title)}
          aria-disabled={!canDelete || undefined}
          aria-describedby={canDelete ? undefined : reasonId}
          onClick={(event) => {
            if (canDelete) onDelete(entry, event.currentTarget)
          }}
        >
          <Icon name="trash-2" />
        </button>
      </article>
    </li>
  )
}
