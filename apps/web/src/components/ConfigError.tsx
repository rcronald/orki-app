import type { EnvIssue } from '../config/env.ts'

interface ConfigErrorProps {
  issues: readonly EnvIssue[]
}

// Pantalla que sustituye a la app cuando la configuración no es válida. Solo
// muestra el nombre de cada variable y el motivo, nunca su valor.
export function ConfigError({ issues }: ConfigErrorProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-red-50 px-6 py-10 text-red-950">
      <div className="w-full max-w-lg space-y-4">
        <h1 className="text-2xl font-bold">La app no está bien configurada</h1>
        <p>
          Revisa estas variables de entorno de <code>apps/web</code>:
        </p>
        <ul className="space-y-2">
          {issues.map((issue) => (
            <li
              key={issue.variable}
              className="rounded-md border border-red-200 bg-white px-3 py-2"
            >
              <code className="font-semibold break-all">{issue.variable}</code>
              <span>: {issue.problem}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm">
          En local, copia <code>apps/web/.env.example</code> a{' '}
          <code>apps/web/.env.local</code>, complétalo y reinicia el servidor.
          Las instrucciones están en el README del repositorio.
        </p>
      </div>
    </main>
  )
}
