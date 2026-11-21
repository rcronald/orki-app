/// <reference types="vite/client" />

// Variables de entorno propias de la app. Son opcionales en el tipo porque
// pueden faltar; `parseEnv` (src/config/env.ts) las valida al arrancar.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_APP_ENV?: string
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
