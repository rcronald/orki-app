import { Route, Routes } from 'react-router'
import { NotFoundPage } from '../pages/NotFoundPage.tsx'
import CatalogHome from './CatalogHome.tsx'
import GenusPage from './GenusPage.tsx'
import { CATALOG_ROUTES } from './paths.ts'
import SpeciesPage from './SpeciesPage.tsx'

// Catálogo público (#232), con o sin sesión: todo va en este chunk, que
// App.tsx carga de forma diferida al abrir cualquier dirección de /catalogo
// (ver catalog/paths.ts). Nada del catálogo va en el chunk inicial ni en el de
// la app; el service worker precachea el código como el de cualquier chunk,
// pero no los datos (ver useCatalogData.ts).
export default function CatalogRoutes() {
  return (
    <Routes>
      <Route index element={<CatalogHome />} />
      <Route path={CATALOG_ROUTES.genus} element={<GenusPage />} />
      <Route path={CATALOG_ROUTES.species} element={<SpeciesPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
