import { Page } from '../components/Page.tsx'

// Provisional: el backoffice real llega en su issue. Solo para quien tiene el
// rol de administrador del catálogo (ver RequireCatalogAdmin).
export function CatalogAdminPage() {
  return (
    <Page title="Administración del catálogo">
      <p className="text-neutral-700">
        Aquí podrás revisar y validar las especies del catálogo.
      </p>
    </Page>
  )
}
