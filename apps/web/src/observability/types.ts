import type { AppEnv } from '../config/env.ts'

/** Datos con los que se inicia Sentry. */
export interface SentrySettings {
  /** DSN ya validado por parseEnv. */
  dsn: string
  /** Ambiente ya validado (VITE_APP_ENV). */
  environment: AppEnv
  /** Commit desplegado, si el build lo conoce (ver vite.config.ts). */
  release: string | undefined
}

/** Datos extra de un error capturado por el límite de errores de React. */
export interface ErrorDetails {
  componentStack?: string
}

/** Lo que el cargador necesita del chunk de Sentry una vez descargado. */
export interface SentryHandle {
  captureException(error: unknown, details?: ErrorDetails): void
  setUserId(userId: string | null): void
}

/** Módulo diferido con el SDK (sentry.ts). */
export interface SentryModule {
  startSentry(settings: SentrySettings, userId: string | null): SentryHandle
}
