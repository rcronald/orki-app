import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useSearchParams } from 'react-router'
import type { CollectionApi } from '../collection/useCollection.ts'
import { useCollection } from '../collection/useCollection.ts'
import {
  useCollectionCopy,
  useOwnershipExtras,
  useExtrasState,
  useRetryExtras,
} from '../collection/useCollectionCopy.ts'
import { useReadOnly } from '../collection/useReadOnly.ts'
import { Page } from '../components/Page.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { QueryAnswer } from '../components/ui/QueryAnswer.tsx'
import { SearchField } from '../components/ui/SearchField.tsx'
import { BackToCollection } from '../detail/BackToCollection.tsx'
import {
  OfflineNotice,
  type OfflineNoticeReason,
} from '../inventory/OfflineNotice.tsx'
import { MatchList, RegisterAction } from '../inventory/OwnershipMatches.tsx'
import { LOAD_ERROR_TEXT } from '../inventory/texts.ts'
import { useOwnershipAnswer } from '../inventory/useOwnershipAnswer.ts'
import {
  CheckAnswer,
  type UnconfirmedNo,
} from '../ownership-check/CheckAnswer.tsx'
import {
  COLLECTION_QUERY_PARAM,
  collectionLinkFor,
} from '../ownership-check/collection-link.ts'
import { CHECK_TEXT } from '../ownership-check/texts.ts'
import { useHaveItSearchEvents } from '../telemetry/useHaveItSearchEvents.ts'

/** Ejemplares que se listan bajo la respuesta, con enlace a su detalle. */
const LISTED_MATCHES = 5

const EMPTY_REGION = 'empty:mt-[calc(var(--space-4)*-1)]'

// «¿Ya la tengo?» en su propia pantalla (/ya-la-tengo, #209): un solo campo y
// la respuesta debajo, para saber en segundos, delante de una planta en un
// vivero, si ya está en la colección.
//
// - La lógica es la del panel del inventario (inventory/useOwnershipAnswer.ts
//   sobre collection/ownership.ts): sale de la colección en memoria al
//   escribir, sin esperar a la red, con los sinónimos, nombres comunes y
//   abreviaturas de la copia local (#18), y el catálogo la mejora cuando hay
//   conexión (#124). Cuentan las plantas con el nombre por validar (por el
//   nombre que se ingresó).
// - Lo escrito va en la dirección (?q=), sustituyendo la entrada del historial
//   (replace): recargar, volver con "atrás" o compartir el enlace conservan la
//   consulta sin llenar el historial.
// - «Ver en mi colección» abre el inventario con el buscador lleno
//   (ownership-check/collection-link.ts); cada ejemplar de la lista enlaza a
//   su detalle.
// - «Volver a Mi colección» es "atrás" si se llegó desde el inventario
//   (estado FROM_INVENTORY de detail/navigation.ts): así recupera su
//   búsqueda, filtros y posición. Abierta la dirección directamente, enlaza a
//   /coleccion.
// - Sin conexión: el indicador de siempre (OfflineNotice) con la fecha de la
//   copia, y registrar desactivado citándolo. Sin copia ni conexión, «Sin
//   copia disponible» (QueryAnswer notice): no se puede saber, que no es lo
//   mismo que "no la tienes". Mientras carga, un texto de espera.
// - Sinónimos, nombres comunes y abreviaturas (#274): llegan después de las
//   plantas (#243) y pueden faltar los de alguna (useExtrasState). Un "Sí"
//   se muestra al momento; un "no" sin ellos completos no se da por seguro
//   (CheckAnswer, `unconfirmed`): "Comprobando…" mientras llegan, que se
//   resuelve solo en la misma región; si fallan, lo dice y ofrece
//   "Reintentar" (useRetryExtras); sin conexión, que se comprobará al
//   volver (la fecha de la copia la da el indicador de arriba).
// - Medición de uso (#146): useHaveItSearchEvents, un evento por búsqueda con
//   la primera respuesta estable y nunca el texto, también sin conexión.
// - Accesibilidad: el campo recibe el foco al entrar; la respuesta va en una
//   región role="status" siempre montada que se anuncia sin mover el foco; la
//   lista y el acceso a registrar quedan fuera, para no leerlos en cada
//   pulsación.
export default function OwnershipCheckPage() {
  const collection = useCollection()
  const { plants } = collection
  const copy = useCollectionCopy()
  const extras = useOwnershipExtras()
  const extrasState = useExtrasState(plants)
  const retryExtras = useRetryExtras()
  const readOnly = useReadOnly()
  const offlineNoticeId = useId()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  // El campo tiene su propio estado: la dirección se actualiza dentro de una
  // transición del enrutador y, si el campo leyera de ella, al escribir
  // deprisa se perderían letras. La dirección solo se lee al abrir.
  const [query, setQueryState] = useState(
    () => searchParams.get(COLLECTION_QUERY_PARAM) ?? '',
  )
  const inputRef = useRef<HTMLInputElement>(null)

  const onMeasure = useHaveItSearchEvents({
    searching: query.trim() !== '',
    offline: readOnly !== null,
  })
  const { ownership, typed, registerName, catalogName, improvedByCatalog } =
    useOwnershipAnswer({
      plants,
      query,
      extras,
      extrasPending: extrasState === 'pending',
      onMeasure,
    })

  // Sin datos que consultar: o cargan, o no se pudieron leer (sin copia).
  const unavailable = plants === null && collection.status === 'error'
  const offlineReason: OfflineNoticeReason | null = unavailable
    ? null
    : (readOnly ?? (copy?.unreachable === 'offline' ? 'unreachable' : null))
  const writeDisabledBy = readOnly === null ? undefined : offlineNoticeId
  // Un «no» con los extras incompletos (#274). Sin conexión (o con la sesión
  // sin confirmar) no se pueden pedir; con ella, si no se están pidiendo,
  // fallaron o no se pidieron, y «Reintentar» los pide.
  const unconfirmed: UnconfirmedNo | null =
    ownership?.outcome !== 'not-owned' || extrasState === 'complete'
      ? null
      : extrasState === 'pending'
        ? 'pending'
        : offlineReason !== null
          ? 'offline'
          : 'failed'

  // Después del efecto de Page, que lleva el foco al título al navegar: este
  // componente lo contiene, así que su efecto corre después.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const state: unknown = location.state
  const setQuery = useCallback(
    (value: string) => {
      setQueryState(value)
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (value === '') next.delete(COLLECTION_QUERY_PARAM)
          else next.set(COLLECTION_QUERY_PARAM, value)
          return next
        },
        // Conserva el estado: «Volver» sigue sabiendo de dónde se llegó.
        { replace: true, preventScrollReset: true, state },
      )
    },
    [setSearchParams, state],
  )

  return (
    <Page
      title={CHECK_TEXT.title}
      width="wide"
      header={{
        variant: 'center',
        meta: CHECK_TEXT.intro,
        back: (
          <BackToCollection className="orki-link orki-pagehead__back">
            <Icon name="arrow-left" />
            {CHECK_TEXT.back}
          </BackToCollection>
        ),
      }}
    >
      <div className="mx-auto flex w-full max-w-[42rem] flex-col gap-space-4 pt-space-3">
        {/* Regiones siempre montadas: así se anuncian al aparecer. Vacías,
            sin el hueco de la separación. */}
        <div role="status" className={EMPTY_REGION}>
          {offlineReason !== null && (
            <OfflineNotice
              id={offlineNoticeId}
              reason={offlineReason}
              savedAt={copy?.savedAt ?? null}
              text={CHECK_TEXT.offlineNotice}
            />
          )}
        </div>
        <SearchField
          label={CHECK_TEXT.fieldLabel}
          hideLabel
          placeholder={CHECK_TEXT.placeholder}
          clearLabel={CHECK_TEXT.clear}
          value={query}
          onValueChange={setQuery}
          inputRef={inputRef}
        />
        <div role="status" className={EMPTY_REGION}>
          <AnswerArea
            collection={collection}
            query={query}
            answer={
              ownership === null ? null : (
                <CheckAnswer
                  ownership={ownership}
                  typed={typed}
                  catalogName={catalogName}
                  collectionLink={collectionLinkFor(
                    ownership,
                    typed,
                    improvedByCatalog,
                  )}
                  unconfirmed={unconfirmed}
                />
              )
            }
          />
        </div>
        {unconfirmed === 'failed' && retryExtras !== null && (
          <Button
            className="self-start"
            onClick={() => {
              retryExtras()
              // El botón desaparece mientras se comprueba: el foco vuelve
              // al campo, y la región de la respuesta anuncia el resultado.
              inputRef.current?.focus()
            }}
          >
            {CHECK_TEXT.retry}
          </Button>
        )}
        {ownership !== null && (
          <>
            <MatchList
              ownership={ownership}
              limit={LISTED_MATCHES}
              showValidation
            />
            <RegisterAction
              ownership={ownership}
              name={registerName}
              disabledBy={writeDisabledBy}
            />
          </>
        )}
        {unavailable && collection.error?.reason !== 'session-ended' && (
          <Button className="self-start" onClick={collection.reload}>
            {CHECK_TEXT.retry}
          </Button>
        )}
      </div>
    </Page>
  )
}

/**
 * Lo que va en la región de la respuesta: la respuesta si la hay; si no hay
 * datos, por qué (cargando, sin copia o el error de lectura).
 */
function AnswerArea({
  collection,
  query,
  answer,
}: {
  collection: CollectionApi
  query: string
  answer: ReactNode
}) {
  const { plants, status, error } = collection
  // Colección vacía y nada escrito (#290): una línea, en vez de nada.
  if (plants?.length === 0 && query.trim() === '')
    return <p className="text-md text-neutral-700">{CHECK_TEXT.empty}</p>
  if (plants !== null) return answer
  if (status === 'error') {
    if (error === null || error.reason === 'offline') {
      return (
        <QueryAnswer
          tone="notice"
          announce={false}
          title={CHECK_TEXT.noCopy.title}
        >
          <p className="orki-answer__text">{CHECK_TEXT.noCopy.text}</p>
        </QueryAnswer>
      )
    }
    const text = LOAD_ERROR_TEXT[error.reason]
    return (
      <QueryAnswer
        tone="notice"
        icon="triangle-alert"
        announce={false}
        title={text.title}
      >
        <p className="orki-answer__text">{text.text}</p>
      </QueryAnswer>
    )
  }
  if (query.trim() === '') return null
  return <p className="text-md text-neutral-700">{CHECK_TEXT.loading}</p>
}
