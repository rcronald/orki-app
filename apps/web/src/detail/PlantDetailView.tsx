import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { catalogSpeciesPath } from '../catalog/paths.ts'
import { FLOWER_COLOR_LABEL, PLANT_STATUS_LABEL } from '../collection/labels.ts'
import type { CollectionPlant } from '../collection/model.ts'
import { Icon } from '../components/ui/Icon.tsx'
import { Panel } from '../components/ui/Panel.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import { StatusBadge } from '../components/ui/StatusBadge.tsx'
import { plantValidationStatus } from '../inventory/plant-display.ts'
import { plantEditPath } from '../routes/paths.ts'
import { formatCalendarDate } from './format.ts'
import { FROM_DETAIL } from './navigation.ts'
import { DETAIL_TEXT, DETAIL_TYPE_LABEL } from './texts.ts'

/**
 * Nombre que se muestra de la planta: el científico del catálogo en cursiva
 * botánica (ScientificName) o el que ingresó la persona, en redonda, si está
 * por validar. Para el h1 del detalle.
 */
export function PlantName({ plant }: { plant: CollectionPlant }) {
  return plant.displayNameIsScientific ? (
    <span className="font-display italic">
      <ScientificName name={plant.displayName} />
    </span>
  ) : (
    <span className="font-body">{plant.displayName}</span>
  )
}

/** Un dato de la línea bajo el nombre; el término solo para el lector. */
function MetaItem({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-center border-l border-neutral-200 px-space-3">
      <dt className="sr-only">{term}</dt>
      <dd className="flex items-center">{children}</dd>
    </div>
  )
}

/**
 * La línea bajo el nombre (#265): la insignia de validación, el
 * identificador («CAT-012»), el tipo y el estado, separados por una raya
 * fina. Es una lista de definiciones con los términos ocultos: el lector
 * oye «Nombre: Validada, Identificador: CAT-012…». Va en el `meta` de la
 * cabecera (PageHeader). Una copia sin conexión anterior al #265 no trae el
 * identificador: se omite.
 */
export function PlantMeta({ plant }: { plant: CollectionPlant }) {
  return (
    // Cada dato lleva la raya a su izquierda; la lista se corre a la
    // izquierda lo que mide la raya y su margen, y el contenedor recorta: así
    // el primero de cada línea (también al partirse en 360 px) va sin raya.
    <div className="overflow-hidden">
      <dl className="-ml-[calc(var(--space-3)+1px)] flex flex-wrap items-center gap-y-space-2">
        <MetaItem term={DETAIL_TEXT.validation}>
          <StatusBadge status={plantValidationStatus(plant)} />
        </MetaItem>
        {plant.code !== null && (
          <MetaItem term={DETAIL_TEXT.code}>
            <span className="font-semibold text-neutral-900">{plant.code}</span>
          </MetaItem>
        )}
        <MetaItem term={DETAIL_TEXT.typeShort}>
          {DETAIL_TYPE_LABEL[plant.type]}
        </MetaItem>
        <MetaItem term={DETAIL_TEXT.status}>
          {PLANT_STATUS_LABEL[plant.status]}
        </MetaItem>
      </dl>
    </div>
  )
}

/** Si el nombre ingresado dice algo distinto del que se muestra. */
function enteredNameDiffers(plant: CollectionPlant): boolean {
  const normalize = (text: string) =>
    text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')
  return normalize(plant.enteredName) !== normalize(plant.displayName)
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-sm text-neutral-700">{label}</dt>
      <dd className="text-md font-semibold text-neutral-900 [overflow-wrap:anywhere]">
        {children}
      </dd>
    </>
  )
}

/** Si falta alguno de los datos opcionales que se completan en la edición. */
function missesOptionalData(plant: CollectionPlant): boolean {
  return (
    plant.origin === null ||
    plant.location === null ||
    plant.nickname === null ||
    plant.flowerColor === null
  )
}

/**
 * «Datos de la planta» (#265): como la maqueta, género, tipo y fecha de
 * adquisición, y además el nombre ingresado si difiere y el origen, la
 * ubicación, el apodo y el color de la flor cuando tienen valor (los que
 * faltan no se listan: no son obligatorios). Debajo, el enlace a su especie
 * en el catálogo si está vinculada y, si falta algún dato opcional y se
 * puede editar, «Completar datos», discreto.
 */
function PlantData({
  plant,
  canEdit,
}: {
  plant: CollectionPlant
  canEdit: boolean
}) {
  const links = [
    plant.species !== null && (
      <Link
        key="catalogo"
        to={catalogSpeciesPath(plant.species.id)}
        className="orki-link -my-[10px] min-h-[44px]"
      >
        <Icon name="book-open" />
        {DETAIL_TEXT.catalog}
      </Link>
    ),
    canEdit && missesOptionalData(plant) && (
      <Link
        key="completar"
        to={plantEditPath(plant.id)}
        state={FROM_DETAIL}
        className="orki-link -my-[10px] min-h-[44px] font-normal"
      >
        <Icon name="pencil" />
        {DETAIL_TEXT.complete}
      </Link>
    ),
  ].filter(Boolean)
  return (
    <Panel title={DETAIL_TEXT.dataLabel}>
      {plant.validation === 'unidentifiable' && (
        <p className="text-sm text-neutral-700">{DETAIL_TEXT.unidentifiable}</p>
      )}
      <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-baseline gap-x-space-5 gap-y-space-2">
        {enteredNameDiffers(plant) && (
          <Row label={DETAIL_TEXT.enteredName}>{plant.enteredName}</Row>
        )}
        <Row label={DETAIL_TEXT.genus}>{plant.genus.name}</Row>
        <Row label={DETAIL_TEXT.type}>{DETAIL_TYPE_LABEL[plant.type]}</Row>
        <Row label={DETAIL_TEXT.acquiredOn}>
          {formatCalendarDate(plant.acquiredOn)}
        </Row>
        {plant.origin !== null && (
          <Row label={DETAIL_TEXT.origin}>{plant.origin}</Row>
        )}
        {plant.location !== null && (
          <Row label={DETAIL_TEXT.location}>{plant.location}</Row>
        )}
        {plant.nickname !== null && (
          <Row label={DETAIL_TEXT.nickname}>{plant.nickname}</Row>
        )}
        {plant.flowerColor !== null && (
          <Row label={DETAIL_TEXT.flowerColor}>
            {FLOWER_COLOR_LABEL[plant.flowerColor]}
          </Row>
        )}
      </dl>
      {links.length > 0 && (
        <div className="flex flex-wrap gap-x-space-5 gap-y-space-3">
          {links}
        </div>
      )}
    </Panel>
  )
}

interface PlantDetailViewProps {
  plant: CollectionPlant
  /** Si se puede editar (con conexión): muestra «Completar datos». */
  canEdit?: boolean
  /** Aviso de lo último que se hizo (guardar, dar de baja…), arriba. */
  notice?: ReactNode
  /** Galería de fotos (PlantGallery, #183): a la izquierda en escritorio. */
  gallery?: ReactNode
  /** Panel de notas (PlantNotes, #265): bajo los datos. */
  notes?: ReactNode
  /**
   * Bitácora (PlantLogSection, #267): a todo el ancho, entre las dos
   * columnas y «Gestionar planta».
   */
  log?: ReactNode
  /** «Gestionar planta» (dar de baja y eliminar), plegado al final. */
  manage?: ReactNode
}

/**
 * Ficha de un ejemplar (#16, rediseñada en el #265) sin la carga de datos.
 * El nombre, la línea de datos (PlantMeta) y «Editar planta» van en la
 * cabecera de la página. Lo usan PlantDetailPage con la colección y la
 * página de muestra con datos fijos.
 *
 * Diseño (maqueta «Ficha de la planta» del #263): en escritorio, dos
 * columnas (orki-detail, la de la galería algo más ancha), la galería a la
 * izquierda y «Datos de la planta» y «Notas» a la derecha; debajo, a todo el
 * ancho, la bitácora y «Gestionar planta». Hasta 720 px, una columna en el
 * orden del documento.
 */
export function PlantDetailView({
  plant,
  canEdit = true,
  notice,
  gallery,
  notes,
  log,
  manage,
}: PlantDetailViewProps) {
  return (
    <div className="flex flex-col gap-space-5">
      {notice}
      <div className="orki-detail min-[721px]:grid-cols-[minmax(0,7fr)_minmax(0,6fr)]">
        <div className="orki-detail__media">{gallery}</div>
        <div className="orki-detail__info">
          <PlantData plant={plant} canEdit={canEdit} />
          {notes}
        </div>
      </div>
      {log}
      {manage}
    </div>
  )
}
