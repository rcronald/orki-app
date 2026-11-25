import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ActionList, ActionRow } from '../components/ui/ActionRow.tsx'
import { Button } from '../components/ui/Button.tsx'
import { ScientificName } from '../components/ui/ScientificName.tsx'
import type { PlantDraft } from './draft.ts'
import { draftName, draftsFull } from './draft-choice.ts'
import { PLANT_FORM_TEXT } from './texts.ts'

/**
 * El nombre de un borrador para leer en una frase: en cursiva botánica si es
 * una especie del catálogo; si no, tal como se escribió.
 */
export function DraftNameText({ draft }: { draft: PlantDraft }) {
  return draft.values.species !== null ? (
    <em className="font-display">
      <ScientificName name={draft.values.species.scientificName} />
    </em>
  ) : (
    <>{draftName(draft)}</>
  )
}

/** Lo que llega al registro, para leer en una frase (#296). */
function IncomingName({
  name,
  scientific,
}: {
  name: string
  scientific: boolean
}) {
  return scientific ? (
    <em className="font-display">
      <ScientificName name={name} />
    </em>
  ) : (
    <>{name}</>
  )
}

interface DraftChoiceProps {
  /** Borradores guardados, del más reciente al más antiguo. */
  drafts: readonly PlantDraft[]
  /** Cuántas fotos tiene cada borrador, por id de planta. */
  photoCounts: ReadonlyMap<string, number>
  /** Lo que llega: el nombre de la especie o el de ?nombre=. */
  incomingName: string
  /** Si lo que llega es una especie del catálogo (para la cursiva). */
  incomingIsSpecies: boolean
  onContinue: (draft: PlantDraft) => void
  onRegister: () => void
  onDiscard: (draft: PlantDraft) => void
}

/**
 * Elegir entre un borrador guardado y lo que llega al abrir el registro
 * (#296; ver draft-choice.ts). Sustituye al formulario hasta que la persona
 * decide: «Continuar borrador» (con su nombre y sus fotos) o «Registrar
 * <especie>», que no borra el borrador. Con dos borradores ya guardados,
 * «Registrar» queda deshabilitado con su motivo y cada borrador se puede
 * descartar.
 *
 * El foco va al título al aparecer (después del foco al título de Page, en una
 * microtarea, como «Nombre» en PlantForm) y la frase se anuncia en una región
 * role="status" que se pinta vacía y se llena en el pintado siguiente.
 */
export function DraftChoice({
  drafts,
  photoCounts,
  incomingName,
  incomingIsSpecies,
  onContinue,
  onRegister,
  onDiscard,
}: DraftChoiceProps) {
  const text = PLANT_FORM_TEXT
  const headingRef = useRef<HTMLHeadingElement>(null)
  const titleId = useId()
  const full = draftsFull(drafts)
  const [visible, setVisible] = useState(false)
  const [discarded, setDiscarded] = useState('')

  useEffect(() => {
    queueMicrotask(() => headingRef.current?.focus())
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const incoming = (
    <IncomingName name={incomingName} scientific={incomingIsSpecies} />
  )
  const [first] = drafts
  let sentence: ReactNode = null
  if (full) {
    sentence = (
      <>
        {text.choiceFullBefore}
        {incoming}
        {text.choiceFullAfter}
      </>
    )
  } else if (first !== undefined) {
    sentence = (
      <>
        {text.choiceOneBefore}
        <DraftNameText draft={first} />
        {text.draftPhotos(photoCounts.get(first.plantId) ?? 0)}
        {text.choiceOneMiddle}
        {incoming}
        {text.choiceOneAfter}
      </>
    )
  }

  const discard = (draft: PlantDraft) => {
    setDiscarded(text.choiceDiscarded(draftName(draft)))
    onDiscard(draft)
    // El botón desaparece con el borrador: el foco vuelve al título.
    headingRef.current?.focus()
  }

  return (
    <section
      aria-labelledby={titleId}
      className="orki-panel flex flex-col gap-space-3"
    >
      <h2
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="orki-panel__title"
      >
        {text.choiceTitle}
      </h2>
      <div role="status">
        {visible && (
          <p className="orki-panel__text [overflow-wrap:anywhere]">
            {sentence}
          </p>
        )}
        {discarded !== '' && <p className="sr-only">{discarded}</p>}
      </div>
      <ActionList>
        {drafts.map((draft) => (
          <li key={draft.plantId}>
            <ActionRow
              icon="file"
              title={text.choiceContinue}
              description={
                <>
                  <DraftNameText draft={draft} />
                  {text.draftPhotos(photoCounts.get(draft.plantId) ?? 0)}
                </>
              }
              onClick={() => onContinue(draft)}
            />
          </li>
        ))}
        <li>
          {full ? (
            <ActionRow
              icon="plus"
              title={text.choiceRegister(incomingName)}
              disabledReason={text.choiceRegisterFull}
            />
          ) : (
            <ActionRow
              icon="plus"
              title={text.choiceRegister(incomingName)}
              description={text.choiceRegisterHint}
              onClick={onRegister}
            />
          )}
        </li>
      </ActionList>
      {full && (
        <div className="flex flex-col items-start gap-space-2">
          {drafts.map((draft) => (
            <Button
              key={draft.plantId}
              className="max-w-full text-left [overflow-wrap:anywhere]"
              onClick={() => discard(draft)}
            >
              {text.choiceDiscard(draftName(draft))}
            </Button>
          ))}
        </div>
      )}
    </section>
  )
}
