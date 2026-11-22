import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { ConfigError } from './components/ConfigError.tsx'
import { EnvironmentBadge } from './components/EnvironmentBadge.tsx'
import { parseEnv } from './config/env.ts'
import { initSupabase } from './lib/supabase.ts'
import { quitarPortadaPrevia } from './prerender/portada-previa.ts'
import { ErrorBoundary } from './observability/ErrorBoundary.tsx'
import { errorReporter, readRelease } from './observability/reporter.ts'
import { AppRouter } from './routes/AppRouter.tsx'

const env = parseEnv(import.meta.env)
const root = createRoot(document.getElementById('root')!)

if (env.ok) {
  initSupabase(env.config)
  // Sentry, solo con DSN: empieza a guardar errores ya y descarga el SDK tras
  // el primer pintado (ver observability/reporter.ts).
  if (env.config.sentryDsn !== undefined) {
    errorReporter.start({
      dsn: env.config.sentryDsn,
      environment: env.config.appEnv,
      release: readRelease(document),
    })
  }
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <AppRouter
            appEnv={env.config.appEnv}
            clerkPublishableKey={env.config.clerkPublishableKey}
          />
        </BrowserRouter>
      </ErrorBoundary>
      <EnvironmentBadge env={env.config.appEnv} />
    </StrictMode>,
  )
} else {
  console.error(
    'Configuración inválida:',
    env.issues.map((issue) => issue.variable).join(', '),
  )
  quitarPortadaPrevia()
  root.render(
    <StrictMode>
      <ConfigError issues={env.issues} />
    </StrictMode>,
  )
}
