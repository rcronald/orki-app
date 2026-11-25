import type { ConfirmDialogProps } from '../components/ui/ConfirmDialog.tsx'

// El aspecto de los diálogos del backoffice (ModalDialog) y lo que sus
// confirmaciones pasan al ConfirmDialog de la app (#338).

/** Capa, caja y título con el aspecto del backoffice. */
export function backofficeClassNames(widthClassName = 'max-w-[480px]') {
  return {
    overlayClassName:
      'fixed inset-[0] z-[50] flex items-center justify-center bg-[rgba(31,31,31,0.5)] p-space-4',
    panelClassName: `flex max-h-[calc(100vh_-_2_*_var(--space-4))] w-full ${widthClassName} flex-col gap-space-4 overflow-y-auto rounded-lg bg-neutral-0 p-space-5 shadow-card`,
    titleClassName:
      'font-display text-xl text-neutral-900 [overflow-wrap:anywhere]',
  }
}

/**
 * Lo que las confirmaciones del backoffice pasan al ConfirmDialog de la app
 * (#338): role="alertdialog" (interrumpen), el aspecto del backoffice y el
 * anuncio de «Guardando…» (o el busyLabel que se pase después) mientras se
 * guarda. El foco inicial lo pone cada una: «Cancelar» si la acción destruye
 * algo y la acción si no.
 */
export const BACKOFFICE_CONFIRM = {
  role: 'alertdialog',
  classNames: backofficeClassNames(),
  announceBusy: true,
  busyLabel: 'Guardando…',
} as const satisfies Partial<ConfirmDialogProps>
