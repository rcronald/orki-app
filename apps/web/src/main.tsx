import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ConfigError } from './components/ConfigError.tsx'
import { EnvironmentBadge } from './components/EnvironmentBadge.tsx'
import { parseEnv } from './config/env.ts'
import { initSupabase } from './lib/supabase.ts'

const env = parseEnv(import.meta.env)
const root = createRoot(document.getElementById('root')!)

if (env.ok) {
  initSupabase(env.config)
  root.render(
    <StrictMode>
      <App />
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
