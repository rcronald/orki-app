import { useParams } from 'react-router'
import { Page } from '../components/Page.tsx'
import { Button } from '../components/ui/Button.tsx'
import { BackToCollection } from '../detail/BackToCollection.tsx'
import { PlantDetailView, PlantName } from '../detail/PlantDetailView.tsx'
import { DETAIL_TEXT } from '../detail/texts.ts'
import { usePlantLookup } from '../detail/usePlantLookup.ts'
import { LoadErrorPanel } from '../inventory/InventoryStates.tsx'

// Detalle de un ejemplar (#16), en /coleccion/:plantId. Exige sesión y va en
// su propio chunk (App.tsx lo carga de forma diferida). Los datos salen de la
// colección en memoria (usePlantLookup); la foto completa se pide aquí.
//
// Siempre se pinta una sola <Page>: al pasar de "cargando" a la planta, el h1
// es el mismo elemento y conserva el foco que le dio la navegación.
export default function PlantDetailPage() {
  const { plantId } = useParams()
  const { lookup, collection } = usePlantLookup(plantId)

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
            actions={
              <section
                aria-label={DETAIL_TEXT.actionsLabel}
                className="flex flex-wrap gap-space-3"
              >
                <Button icon="pencil" aria-disabled>
                  {DETAIL_TEXT.edit}
                </Button>
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
