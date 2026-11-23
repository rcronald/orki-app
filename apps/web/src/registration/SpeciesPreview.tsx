import { useEffect, useState } from 'react'
import { ReferencePhoto } from '../components/ui/ReferencePhoto.tsx'
import type { ReferencePicture } from '../lib/referencePhotos.ts'
import { PLANT_FORM_TEXT } from './texts.ts'

/** Lee la foto de referencia de una especie (getSpeciesReferencePhoto). */
export type LoadReferencePhoto = (
  speciesId: string,
  options: { signal: AbortSignal },
) => Promise<ReferencePicture | null>

/**
 * «Así es esta especie» (#234): bajo el nombre del registro, al elegir una
 * especie del catálogo, su foto de referencia en pequeño con el crédito, para
 * confirmar que es la correcta. Una consulta por especie elegida (la misma
 * elección no se vuelve a pedir mientras el formulario siga montado) y
 * ninguna sin conexión. Sin foto, mientras llega o si falla, no se pinta
 * nada: es una ayuda, no un paso.
 */
export function SpeciesPreview({
  speciesId,
  scientificName,
  online,
  load,
}: {
  speciesId: string
  scientificName: string
  online: boolean
  load: LoadReferencePhoto
}) {
  const [result, setResult] = useState<{
    speciesId: string
    picture: ReferencePicture | null
  } | null>(null)
  const known = result?.speciesId === speciesId

  useEffect(() => {
    if (!online || known) return
    const controller = new AbortController()
    load(speciesId, { signal: controller.signal }).then(
      (picture) => {
        if (!controller.signal.aborted) setResult({ speciesId, picture })
      },
      () => undefined,
    )
    return () => controller.abort()
  }, [speciesId, online, known, load])

  const picture = known ? result.picture : null
  if (picture === null) return null
  return (
    <ReferencePhoto
      key={picture.sourcePhotoId}
      picture={picture}
      scientificName={scientificName}
      variant="compact"
      title={PLANT_FORM_TEXT.speciesPreview}
      className="mt-space-3"
    />
  )
}
