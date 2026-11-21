import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Page } from '../components/Page.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Icon } from '../components/ui/Icon.tsx'
import { ActionNotice } from '../detail/ActionNotice.tsx'
import { BackToCollection } from '../detail/BackToCollection.tsx'
import { FROM_DETAIL } from '../detail/navigation.ts'
import {
  clearPlantNotice,
  peekPlantNotice,
  type PlantNotice,
} from '../detail/notice.ts'
import { PlantDetailView, PlantName } from '../detail/PlantDetailView.tsx'
import { DETAIL_TEXT } from '../detail/texts.ts'
import { usePlantLookup } from '../detail/usePlantLookup.ts'
import { LoadErrorPanel } from '../inventory/InventoryStates.tsx'
import { plantEditPath } from '../routes/paths.ts'

// Detalle de un ejemplar (#16), en /coleccion/:plantId. Exige sesión y va en
// su propio chunk (App.tsx lo carga de forma diferida). Los datos salen de la
// colección en memoria (usePlantLookup); la foto completa se pide aquí.
//
// Siempre se pinta una sola <Page>: al pasar de "cargando" a la planta, el h1
// es el mismo elemento y conserva el foco que le dio la navegación.

/** El aviso que dejó la edición para esta planta, si lo hay. */
function savedNoticeFor(plantId: string | undefined): PlantNotice | null {
  const notice = peekPlantNotice()
  return notice?.kind === 'saved' && notice.plantId === plantId ? notice : null
}

export default function PlantDetailPage() {
  const { plantId } = useParams()
  const { lookup, collection } = usePlantLookup(plantId)
  // "Guardaste los cambios" al volver de la edición: se lee al montarse y se
  // recoge, para que no vuelva a salir.
  const [saved, setSaved] = useState(() => savedNoticeFor(plantId))
  useEffect(() => {
    if (saved !== null) clearPlantNotice(saved)
  }, [saved])

  switch (lookup.status) {
    case 'loading':
      return (
        <Page title={DETAIL_TEXT.loadingTitle} before={<BackToCollection />}>
          <p role="status" className="text-md text-neutral-700">
            {DETAIL_TEXT.loading}
          </p>
        </Page>
      )
    case 'error':
      return (
        <Page title={DETAIL_TEXT.errorTitle} before={<BackToCollection />}>
          <LoadErrorPanel error={lookup.error} onRetry={collection.reload} />
        </Page>
      )
    case 'not-found':
      return (
        <Page title={DETAIL_TEXT.notFoundTitle} before={<BackToCollection />}>
          <p className="text-md text-neutral-700">{DETAIL_TEXT.notFound}</p>
        </Page>
      )
    case 'found': {
      const { plant } = lookup
      return (
        <Page
          title={plant.displayName}
          heading={<PlantName plant={plant} />}
          before={<BackToCollection />}
        >
          <PlantDetailView
            plant={plant}
            notice={
              saved && (
                <ActionNotice onDismiss={() => setSaved(null)}>
                  {DETAIL_TEXT.saved}
                </ActionNotice>
              )
            }
            actions={
              <section
                aria-label={DETAIL_TEXT.actionsLabel}
                className="flex flex-wrap gap-space-3"
              >
                <Link
                  to={plantEditPath(plant.id)}
                  state={FROM_DETAIL}
                  className="orki-btn orki-btn--secondary"
                >
                  <Icon name="pencil" />
                  {DETAIL_TEXT.edit}
                </Link>
                <Button aria-disabled>{DETAIL_TEXT.retire}</Button>
                <Button icon="trash-2" aria-disabled>
                  {DETAIL_TEXT.delete}
                </Button>
              </section>
            }
          />
        </Page>
      )
    }
  }
}
