import { Link } from 'react-router'
import { PATHS } from '../routes/paths.ts'
import { PLANT_EDIT_NOTICE_TEXT, PLANT_FORM_TEXT } from './texts.ts'

/**
 * Aviso de la galería con un nombre por validar (#12, #210, #221): el equipo
 * del catálogo podrá ver las fotos para validar el nombre, como dice la
 * página de privacidad. Sin fotos, las recomienda; con fotos, avisa. Describe
 * la galería (aria-describedby), no es un paso más: registrar sin fotos sigue
 * igual.
 *
 * El enlace a Privacidad no pierde lo escrito: al registrar, el borrador se
 * conserva al salir por un enlace de la app y se recupera al volver; al
 * editar no hay borrador, así que se abre en otra pestaña y lo dice.
 */
export function PendingPhotoNotice({
  count,
  newTab,
}: {
  count: number
  newTab: boolean
}) {
  const text = PLANT_FORM_TEXT
  return (
    <>
      {count > 0 ? text.pendingPhotoNotice(count) : text.pendingPhotoHint}{' '}
      {text.pendingPhotoMore}{' '}
      {newTab ? (
        <a href={PATHS.privacy} target="_blank" rel="noopener noreferrer">
          {text.privacyLink}{' '}
          <span className="sr-only">
            {PLANT_EDIT_NOTICE_TEXT.privacyNewTab}
          </span>
        </a>
      ) : (
        <Link to={PATHS.privacy}>{text.privacyLink}</Link>
      )}
      .
    </>
  )
}
