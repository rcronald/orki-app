import { ReferencePhoto } from '../components/ui/ReferencePhoto.tsx'
import {
  useReferencePhoto,
  type LoadReferencePhoto,
} from '../lib/useReferencePhoto.ts'
import { PLANT_FORM_TEXT } from './texts.ts'

export type { LoadReferencePhoto } from '../lib/useReferencePhoto.ts'

/**
 * «Así es esta especie» (#234): bajo el nombre del registro, al elegir una
 * especie del catálogo, su foto de referencia en pequeño con el crédito, para
 * confirmar que es la correcta. Una consulta por especie elegida
 * (useReferencePhoto la recuerda en memoria) y ninguna sin conexión. Sin
 * foto, mientras llega o si falla, no se pinta nada: es una ayuda, no un paso.
 */
export function SpeciesPreview({
  speciesId,
  scientificName,
  load,
}: {
  speciesId: string
  scientificName: string
  load: LoadReferencePhoto
}) {
  const picture = useReferencePhoto(speciesId, load)
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
