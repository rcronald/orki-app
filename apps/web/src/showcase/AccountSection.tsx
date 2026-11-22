import { useMemo, useState } from 'react'
import { AccountView } from '../account/AccountView.tsx'
import {
  AccountDeletionError,
  type AccountDeletionEffects,
  type DeletionFailureReason,
  type DeletionStep,
} from '../account/deletion.ts'
import { noAccountDeletionDevice } from '../account/device-cleanup.ts'
import { Chip } from '../components/ui/Chip.tsx'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import { Example, Section } from './layout.tsx'

// La pantalla de cuenta (/cuenta, #110) sin Clerk ni Supabase: los pasos de la
// eliminación son simulados (esperan un momento) y se puede elegir cuál falla
// la primera vez. No borra nada real (ni del dispositivo: noAccountDeletionDevice);
// sí usa el localStorage del navegador para la marca de "eliminación a medias"
// del usuario "muestra".

type Scenario = 'ok' | DeletionStep | 'not-allowed-before' | 'not-allowed-after'

const SCENARIOS: readonly { id: Scenario; label: string }[] = [
  { id: 'ok', label: 'Todo bien' },
  { id: 'photos', label: 'Fallan las fotos' },
  { id: 'plants', label: 'Fallan las plantas' },
  { id: 'profile', label: 'Falla el perfil' },
  { id: 'account', label: 'Clerk pide verificar' },
  { id: 'not-allowed-after', label: 'Clerk lo rechaza' },
  { id: 'not-allowed-before', label: 'Sin permiso de Clerk' },
]

const DELAY_MS = 700

function sampleEffects(scenario: Scenario): AccountDeletionEffects {
  let failed = false
  const step =
    (name: DeletionStep, reason: DeletionFailureReason = 'offline') =>
    () =>
      new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          const shouldFail =
            !failed &&
            (scenario === name ||
              (scenario === 'not-allowed-after' && name === 'account'))
          if (shouldFail) {
            failed = true
            reject(new AccountDeletionError(reason))
          } else resolve()
        }, DELAY_MS)
      })
  return {
    deletePhotos: step('photos'),
    deletePlants: step('plants', 'failed'),
    deleteProfile: step('profile'),
    deleteAccount: step(
      'account',
      scenario === 'not-allowed-after'
        ? 'not-allowed'
        : 'reverification-cancelled',
    ),
  }
}

export function AccountSection() {
  const [scenario, setScenario] = useState<Scenario>('ok')
  const [deleted, setDeleted] = useState(false)
  const effects = useMemo(() => sampleEffects(scenario), [scenario])

  return (
    <Section
      id="cuenta"
      title="Pantalla de cuenta"
      description="AccountView, el contenido de /cuenta, con pasos de eliminación simulados. Elige qué falla la primera vez; el reintento sale bien."
    >
      <ChipGroup aria-label="Resultado de la eliminación">
        {SCENARIOS.map((option) => (
          <Chip
            key={option.id}
            selected={scenario === option.id}
            onClick={() => {
              setScenario(option.id)
              setDeleted(false)
            }}
          >
            {option.label}
          </Chip>
        ))}
      </ChipGroup>
      <Example title="Tu cuenta">
        {deleted ? (
          <p role="status" className="text-md">
            Cuenta eliminada (simulado). En la app se cierra la sesión y se
            vuelve al inicio con el aviso.
          </p>
        ) : (
          <AccountView
            key={scenario}
            userId="muestra"
            email="persona@example.com"
            canDeleteAccount={scenario !== 'not-allowed-before'}
            effects={effects}
            onDeleted={() => setDeleted(true)}
            device={noAccountDeletionDevice}
          />
        )}
      </Example>
    </Section>
  )
}
