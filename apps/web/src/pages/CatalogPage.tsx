import { Page } from '../components/Page.tsx'

// Provisional: el catálogo real llega en su issue. Es público.
export function CatalogPage() {
  return (
    <Page title="Catálogo">
      <p className="text-neutral-700">
        Aquí podrás consultar las especies de orquídeas, con o sin sesión.
      </p>
    </Page>
  )
}
