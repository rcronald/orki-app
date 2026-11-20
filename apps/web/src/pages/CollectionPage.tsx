import { useCollection } from '../collection/useCollection.ts'
import { Page } from '../components/Page.tsx'
import { InventoryView } from '../inventory/InventoryView.tsx'

// Inventario de la colección del usuario (#14): conecta la pantalla con la
// colección compartida (useCollection). Exige sesión.
export function CollectionPage() {
  const { status, plants, error, reload } = useCollection()

  return (
    <Page title="Mi colección" width="wide">
      <InventoryView
        status={status}
        plants={plants}
        error={error}
        onRetry={reload}
      />
    </Page>
  )
}
