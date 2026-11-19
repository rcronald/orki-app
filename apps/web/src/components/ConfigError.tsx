import type { EnvIssue } from '../config/env.ts'

interface ConfigErrorProps {
  issues: readonly EnvIssue[]
}

// Pantalla que sustituye a la app cuando la configuración no es válida. Solo
// muestra el nombre de cada variable y el motivo, nunca su valor. El error no
// se comunica solo con color: lleva la palabra "Error" delante del título.
export function ConfigError({ issues }: ConfigErrorProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-neutral-0 px-space-4 py-space-6 text-neutral-900">
      <div className="flex w-full max-w-lg flex-col gap-space-4">
        <div className="flex flex-col gap-space-1">
          <p className="text-sm font-semibold text-danger">
            Error de configuración
          </p>
          <h1 className="font-display text-display font-semibold text-neutral-900">
            La app no está bien configurada
          </h1>
        </div>
        <p>
          Revisa estas variables de entorno de <code>apps/web</code>:
        </p>
        <ul className="flex flex-col gap-space-2">
          {issues.map((issue) => (
            <li
              key={issue.variable}
              className="rounded-md border border-danger bg-danger-soft px-space-3 py-space-2"
            >
              <code className="font-semibold break-all text-danger">
                {issue.variable}
              </code>
              <span>: {issue.problem}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-neutral-700">
          En local, copia <code>apps/web/.env.example</code> a{' '}
          <code>apps/web/.env.local</code>, complétalo y reinicia el servidor.
          Las instrucciones están en el README del repositorio.
        </p>
      </div>
    </main>
  )
}
