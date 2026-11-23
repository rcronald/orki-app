import { useEffect, useState } from 'react'
import { catalogSearchFailure } from '../lib/catalogSearch.ts'
import type { FormGenus } from './form-state.ts'
import type { QuickGeneraState } from './GenusField.tsx'

/**
 * Géneros de acceso rápido del campo de género, con su estado y «Volver a
 * cargar». Lo comparten el registro (PlantForm) y la edición (#266).
 */
export function useQuickGenera(
  load: () => Promise<readonly FormGenus[]>,
  online: boolean,
): [QuickGeneraState, () => void] {
  const [state, setState] = useState<QuickGeneraState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  // Se vuelve a pedir al recuperar la conexión; la carga está en caché, así
  // que si ya llegó no sale ninguna petición.
  useEffect(() => {
    let active = true
    load().then(
      (genera) => {
        if (active) setState({ status: 'ready', genera })
      },
      (error: unknown) => {
        if (!active) return
        const reason =
          catalogSearchFailure(error) === 'offline' ? 'offline' : 'failed'
        setState({ status: 'error', reason })
      },
    )
    return () => {
      active = false
    }
  }, [load, attempt, online])

  const retry = () => {
    setState({ status: 'loading' })
    setAttempt((value) => value + 1)
  }
  return [state, retry]
}
