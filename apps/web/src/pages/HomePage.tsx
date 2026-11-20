import { AccountControls } from '../auth/AccountControls.tsx'

// Pantalla de inicio provisional. Es pública: se ve con o sin sesión y aunque
// Clerk no cargue (sin conexión).
export function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col bg-neutral-0">
      <header className="flex justify-end px-space-4 py-space-3">
        <AccountControls />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-space-3 px-space-4 pb-space-6 text-center">
        <h1 className="font-display text-display font-semibold text-neutral-900">
          Orki
        </h1>
        <p className="max-w-sm text-lg text-neutral-700">
          Tu colección de orquídeas, siempre a mano.
        </p>
      </main>
    </div>
  )
}
