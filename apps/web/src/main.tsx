import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { ConfigError } from './components/ConfigError.tsx'
import { EnvironmentBadge } from './components/EnvironmentBadge.tsx'
import { parseEnv } from './config/env.ts'
import { initSupabase } from './lib/supabase.ts'
import { isShowcaseRoute } from './showcase/route.ts'

// Página interna de muestra del design system (/muestra), solo fuera de
// producción. La comparación con import.meta.env.VITE_APP_ENV es estática: en
// un build con VITE_APP_ENV=prod Vite la sustituye por false, el import
// dinámico desaparece y el código de la muestra no entra en el bundle. Además,
// isShowcaseRoute vuelve a comprobar el ambiente ya validado.
const ShowcasePage =
  import.meta.env.VITE_APP_ENV === 'prod'
    ? null
    : lazy(() => import('./showcase/ShowcasePage.tsx'))

const env = parseEnv(import.meta.env)
const root = createRoot(document.getElementById('root')!)

if (env.ok) {
  initSupabase(env.config)
  root.render(
    <StrictMode>
      {ShowcasePage &&
      isShowcaseRoute(window.location.pathname, env.config.appEnv) ? (
        <Suspense fallback={null}>
          <ShowcasePage />
        </Suspense>
      ) : (
        // La muestra queda fuera de Clerk: no necesita sesión ni cargar su
        // script.
        <AuthProvider publishableKey={env.config.clerkPublishableKey}>
          <App />
        </AuthProvider>
      )}
      <EnvironmentBadge env={env.config.appEnv} />
    </StrictMode>,
  )
} else {
  console.error(
    'Configuración inválida:',
    env.issues.map((issue) => issue.variable).join(', '),
  )
  root.render(
    <StrictMode>
      <ConfigError issues={env.issues} />
    </StrictMode>,
  )
}
