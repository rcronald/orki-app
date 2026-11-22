import { useState } from 'react'
import { Button } from '../components/ui/Button.tsx'
import { Chip } from '../components/ui/Chip.tsx'
import { ChipGroup } from '../components/ui/ChipGroup.tsx'
import {
  FormActions,
  FormLayout,
  FormPair,
} from '../components/ui/FormLayout.tsx'
import { MatchBadge } from '../components/ui/MatchBadge.tsx'
import {
  PhotoGallery,
  type GalleryPhoto,
} from '../components/ui/PhotoGallery.tsx'
import { TextField } from '../components/ui/TextField.tsx'
import samplePhoto from './foto-muestra.svg'
import { Example, Section } from './layout.tsx'

// Piezas del registro con galería (#220): galería de fotos con sus estados,
// insignia de coincidencia, tipo como control segmentado en el celular,
// formulario a dos columnas y pie de acciones. Los títulos de la galería son
// h3 aquí; en la pantalla, h2.

const photo = (id: string, state: GalleryPhoto['state']): GalleryPhoto => ({
  id,
  src: samplePhoto,
  state,
})

const THREE = [
  photo('a', { status: 'ready' }),
  photo('b', { status: 'ready' }),
  photo('c', { status: 'ready' }),
]
const SIX = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) =>
  photo(id, { status: 'ready' }),
)
const STATES: GalleryPhoto[] = [
  photo('a', { status: 'saved' }),
  photo('b', { status: 'uploading', progress: 0.4 }),
  photo('c', { status: 'error' }),
  { id: 'd', state: { status: 'preparing' } },
]

const noop = () => undefined

/** Galería que se puede tocar: quitar y «Deshacer» no hace falta aquí. */
function LiveGallery() {
  const [photos, setPhotos] = useState(THREE)
  return (
    <PhotoGallery
      headingLevel={3}
      photos={photos}
      max={6}
      onRemove={(id) => setPhotos((list) => list.filter((p) => p.id !== id))}
      onTakePhoto={noop}
      onChoosePhotos={() =>
        setPhotos((list) =>
          list.length >= 6
            ? list
            : [...list, photo(`n${String(list.length)}`, { status: 'ready' })],
        )
      }
    />
  )
}

export function RegistrationPiecesSection() {
  const [type, setType] = useState('species')
  return (
    <Section
      id="registro-piezas"
      title="Registro: piezas"
      description="Piezas del registro con galería (#220): galería de hasta 6 fotos, insignia de coincidencia, tipo como control segmentado hasta 720 px, formulario a dos columnas y pie de acciones."
    >
      <Example
        title="Galería de fotos (PhotoGallery), parcial"
        description="Título, contador, cuadrícula de tres columnas, «Principal» en la primera y quitar en la esquina (objetivo de 44 px). Quita fotos o añade con «Elegir fotos»: al quitar, el foco pasa a la que ocupa su lugar."
      >
        <LiveGallery />
      </Example>
      <Example
        title="Galería vacía y llena"
        description="Llena, las dos acciones quedan con aria-disabled y el motivo enlazado."
      >
        <PhotoGallery
          headingLevel={3}
          photos={[]}
          max={6}
          onTakePhoto={noop}
          onChoosePhotos={noop}
        />
        <PhotoGallery
          headingLevel={3}
          photos={SIX}
          max={6}
          onRemove={noop}
          onChoosePhotos={noop}
        />
      </Example>
      <Example
        title="Estados de cada miniatura"
        description="Guardada, subiendo (con progreso), con error (con «Reintentar») y preparando. Con un nombre por validar, el aviso va bajo el título."
      >
        <PhotoGallery
          headingLevel={3}
          photos={STATES}
          max={6}
          onRemove={noop}
          onRetry={noop}
          onChoosePhotos={noop}
          notice="Como el nombre queda por validar, el equipo del catálogo podrá ver estas fotos para identificarla."
        />
      </Example>
      <Example
        title="Insignia de coincidencia (MatchBadge)"
        description="Bajo el campo de nombre, con una especie del catálogo elegida."
      >
        <MatchBadge />
      </Example>
      <Example
        title="Grupo de opciones (ChipGroup segmented)"
        description="Chips con el elegido en verde; hasta 720 px, una fila de ancho completo con aspecto de control segmentado. Siguen siendo botones de alternar."
      >
        <ChipGroup aria-label="Tipo de ejemplo" segmented>
          {[
            ['species', 'Especie'],
            ['hybrid', 'Híbrido'],
            ['unknown', 'No sé'],
          ].map(([value, label]) => (
            <Chip
              key={value}
              selected={type === value}
              onClick={() => setType(value ?? 'species')}
            >
              {label}
            </Chip>
          ))}
        </ChipGroup>
      </Example>
      <Example
        title="Formulario a dos columnas (FormLayout) y pie de acciones (FormActions)"
        description="Datos a la izquierda y galería a la derecha, alineada arriba; «extra» sigue a la izquierda. Hasta 720 px, una columna y la acción principal a todo el ancho, con «Cancelar» como enlace encima."
      >
        <FormLayout
          main={
            <FormPair>
              <TextField label="Campo de ejemplo" />
              <TextField label="Otro campo" />
            </FormPair>
          }
          aside={
            <PhotoGallery
              headingLevel={3}
              photos={THREE.slice(0, 1)}
              max={6}
              onChoosePhotos={noop}
            />
          }
          extra={<TextField label="Debajo, a la izquierda" />}
        />
        <FormActions>
          <Button className="orki-formactions__secondary">Cancelar</Button>
          <Button variant="primary">Registrar orquídea</Button>
        </FormActions>
      </Example>
    </Section>
  )
}
