import { authPageFor } from './auth/paths.ts'
import { HomePage } from './pages/HomePage.tsx'
import { SignInPage } from './pages/SignInPage.tsx'
import { SignUpPage } from './pages/SignUpPage.tsx'

interface AppProps {
  /** Ruta actual; por defecto la del navegador. */
  pathname?: string
}

// Elección provisional de pantalla sin enrutador: se mira la ruta una vez al
// arrancar y los enlaces entre pantallas recargan la página. Se sustituye por
// el enrutador del issue #57, que montará SignInPage y SignUpPage en sus rutas.
function App({ pathname = window.location.pathname }: AppProps) {
  const authPage = authPageFor(pathname)
  if (authPage === 'sign-in') return <SignInPage />
  if (authPage === 'sign-up') return <SignUpPage />
  return <HomePage />
}

export default App
