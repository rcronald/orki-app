import { Link } from 'react-router'
import { Icon } from '../components/ui/Icon.tsx'
import { FROM_INVENTORY } from '../detail/navigation.ts'
import { PATHS } from '../routes/paths.ts'
import { COLLECTION_ACTIONS_TEXT } from './texts.ts'

// Acciones de la cabecera de «Mi colección» (#208), para la prop actions de
// PageHeader: «Registrar orquídea» (la principal, en verde) y «¿Ya la tengo?»
// (secundaria), que abre la consulta rápida en su propia pantalla (#209). En
// escritorio van a la derecha del título; hasta 720 px, apiladas a todo el
// ancho en este orden (lo hace la pieza). Sustituyen a la barra fija de
// registrar de abajo del celular.
//
// «¿Ya la tengo?» lleva en el estado de la navegación que se llegó desde el
// inventario (FROM_INVENTORY, detail/navigation.ts): su «Volver a Mi
// colección» puede ser entonces "atrás" y recuperar la búsqueda, los filtros
// (en la URL) y la posición, como el detalle.
//
// Sin conexión (#18), registrar se ve desactivado (aria-disabled, sigue en el
// orden del tabulador) y cita el motivo (disabledBy). «¿Ya la tengo?» sigue
// disponible: consulta la copia local.
export function CollectionActions({ disabledBy }: { disabledBy?: string }) {
  return (
    <>
      {disabledBy === undefined ? (
        <Link to={PATHS.newPlant} className="orki-btn orki-btn--primary">
          <Icon name="plus" />
          {COLLECTION_ACTIONS_TEXT.register}
        </Link>
      ) : (
        <button
          type="button"
          aria-disabled="true"
          aria-describedby={disabledBy}
          className="orki-btn orki-btn--primary"
        >
          <Icon name="plus" />
          {COLLECTION_ACTIONS_TEXT.register}
        </button>
      )}
      <Link
        to={PATHS.ownershipCheck}
        state={FROM_INVENTORY}
        className="orki-btn orki-btn--secondary"
      >
        <Icon name="circle-check" />
        {COLLECTION_ACTIONS_TEXT.ownershipCheck}
      </Link>
    </>
  )
}
