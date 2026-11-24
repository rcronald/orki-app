import { Link, useLocation } from 'react-router'
import { TextPage, type TextPageSection } from '../components/TextPage.tsx'
import { PATHS } from '../routes/paths.ts'
import {
  isPrivacyContactPending,
  PRIVACY_CONTACT,
  privacyContactHref,
} from './contact.ts'

// Página pública de privacidad (/privacidad, #111, parte de #26), con el
// diseño de página de texto del design system (#202, #194): índice «En esta
// página» con cuatro secciones («Qué datos guardamos», «Quién puede verlos»,
// «Qué se guarda en tu dispositivo» y «Cómo eliminar tu cuenta»), cada una
// con una frase de resumen; las secciones anteriores del texto aprobado van
// dentro, íntegras, como subsecciones (h3). El contacto cierra la página,
// fuera del índice.
//
// Texto revisado y aprobado por el responsable del proyecto el 22 de
// noviembre de 2026. Lo redactó un agente a partir del código (modo sin
// conexión, eventos de uso, Sentry, cola de propuestas y exportación a CSV).
// No es asesoría legal y no lo ha revisado nadie con criterio legal (ley
// peruana de protección de datos personales, #26); sigue siendo conveniente.
// Al cambiar lo que guarda o envía la app (eventos, Sentry,
// lo que se guarda en el dispositivo...), este texto cambia con ella.
//
// Con el #202 el texto aprobado se conserva entero salvo la atribución del
// catálogo, que pasó a «Créditos y fuentes» (con un enlace desde aquí); se
// reagrupó en cuatro secciones y se añadieron las frases de resumen: de ahí
// la fecha nueva.
// Con el #184 (varias fotos por planta) cambió lo que ve el equipo del
// catálogo de las plantas por validar: hasta seis fotos y todas las de esas
// plantas, no solo la principal.
// Con el #267 (aprobado por el responsable el 23 de noviembre de 2026) se
// añadieron las notas de cada planta (#265) y la bitácora: qué se guarda,
// dónde, que solo las ve su dueño (tampoco el equipo del catálogo), que la
// bitácora no se guarda en el dispositivo, que no va en el CSV y cómo se
// borran (el registro, la planta o la cuenta).
// PrivacyPage.test.tsx comprueba que no falta ninguna frase del texto
// aprobado.
//
// Va en su propio chunk (carga diferida desde App.tsx), sin importar Clerk.
// El enlace de volver lo pone TextPage según de dónde se vino.

/** Fecha de la última actualización del texto, en el formato que se muestra. */
const PRIVACY_LAST_UPDATED = '23 de noviembre de 2026'
const PRIVACY_LAST_UPDATED_ISO = '2026-11-23'

function sections(state: unknown): TextPageSection[] {
  return [
    {
      id: 'privacidad-datos',
      title: 'Qué datos guardamos',
      summary:
        'Los datos de tu cuenta, las plantas que registras con sus notas y su bitácora, y las fotos que decides añadir, además de algunas mediciones de uso y errores.',
      children: (
        <>
          <ul>
            <li>
              <strong>Tu cuenta:</strong> tu correo y, si entras con Google, los
              datos de tu perfil de Google que recibe el servicio de acceso
              (como tu nombre y tu foto). Además, orqui.app guarda un perfil con
              tu identificador de usuario y el idioma de la app.
            </li>
            <li>
              <strong>Tus plantas:</strong> lo que registras de cada una: el
              nombre, el género, el tipo, la fecha de adquisición, el origen y,
              si los añades, la ubicación, el apodo, el color de la flor y su
              estado (activa, perdida o regalada). También las notas que
              escribas sobre ella.
            </li>
            <li>
              <strong>La bitácora de tus plantas:</strong> los registros que
              añades a cada una: el tipo de actividad (riego, nutrición,
              mantenimiento preventivo o sanidad preventiva), el título, la
              fecha y la hora en que lo guardaste y, si los añades, una
              descripción, una foto y si observaste floración.
            </li>
            <li>
              <strong>Las fotos de tus plantas:</strong> antes de subirlas, la
              app las reduce en tu dispositivo y les quita los metadatos que
              guarda la cámara, incluida la ubicación. Se guardan la foto y una
              miniatura. Las fotos de la bitácora se preparan igual.
            </li>
            <li>
              <strong>Mediciones de uso y errores:</strong> lo explicamos en la
              sección siguiente.
            </li>
          </ul>
          <p>
            Los usamos para que la app funcione: que entres en tu cuenta y veas
            y gestiones tu colección. Las mediciones y los errores, además, para
            mejorarla.
          </p>
          <h3 className="orki-textpage__subheading">
            Mediciones de uso y errores
          </h3>
          <p>La app registra dos tipos de evento de uso:</p>
          <ul>
            <li>
              <strong>Cuando registras una planta:</strong> cuánto tardaste, si
              llevaba foto y si el nombre quedó «por validar».
            </li>
            <li>
              <strong>Cuando buscas si ya tienes una planta</strong> («¿Ya la
              tengo?»): cuánto tardó la respuesta y cuál fue (la tienes, no la
              tienes o tienes parecidas).
            </li>
          </ul>
          <p>
            Cada evento lleva también tu identificador de usuario, la hora y si
            se generó sin conexión. No lleva el texto que buscaste, los nombres
            de tus plantas, tu correo ni tu nombre.
          </p>
          <p>
            Los usamos para saber si la app cumple su objetivo: que registrar
            una orquídea tome menos de un minuto y que saber si ya la tienes
            tome menos de cinco segundos.
          </p>
          <p>
            Si la app falla, envía el error a Sentry para que podamos
            corregirlo. El informe lleva el mensaje del error, en qué parte del
            código ocurrió, la dirección de la pantalla, tu navegador y tu
            sistema, la versión de la app, tu identificador de usuario y los
            últimos pasos que hiciste en la app (pantallas abiertas, botones
            pulsados y peticiones al servidor). Antes de enviarlo, la app quita
            tu correo, tu nombre, tu dirección IP, las cookies, el contenido de
            las peticiones, lo que escribiste en la búsqueda y en otros
            parámetros de las direcciones, tu zona horaria y tu idioma, los
            mensajes de la consola y los textos de los botones pulsados. No
            graba la pantalla ni mide el rendimiento.
          </p>
          <p>
            Sentry también recibe un aviso cada vez que abres la app, con la
            versión, tu navegador y tu identificador de usuario, para saber
            cuántas veces termina con un fallo.
          </p>
          <p>
            En orqui.app no hay publicidad ni otros servicios de analítica o de
            publicidad.
          </p>
          <h3 className="orki-textpage__subheading">
            Dónde se guardan y quién los procesa
          </h3>
          <ul>
            <li>
              <strong>Clerk</strong> gestiona el acceso: tu cuenta, tu correo,
              el acceso con Google y tu sesión.
            </li>
            <li>
              <strong>Supabase</strong> guarda tu perfil, tus plantas con sus
              notas y su bitácora, sus fotos y tus eventos de uso. Las fotos
              están en un almacenamiento privado: no tienen una dirección
              pública.
            </li>
            <li>
              <strong>Sentry</strong> recibe los informes de errores de la app.
            </li>
            <li>
              <strong>Vercel</strong> aloja la app y la entrega a tu navegador.
            </li>
          </ul>
          <p>
            El catálogo de especies que usa el buscador es común para todos y no
            contiene datos de quienes usan orqui.app. Las fotos de referencia de
            las especies muestran el nombre de su autor, como exige su licencia.
            La fuente del catálogo y las licencias están en{' '}
            <Link to={PATHS.credits} state={state}>
              Créditos y fuentes
            </Link>
            .
          </p>
        </>
      ),
    },
    {
      id: 'privacidad-acceso',
      title: 'Quién puede verlos',
      summary:
        'Tu colección es privada. Si el nombre de una planta queda por validar, el equipo del catálogo puede revisar el nombre y las fotos asociadas.',
      children: (
        <>
          <p>
            Tus plantas, sus notas, su bitácora y sus fotos solo las ves tú. La
            base de datos solo entrega a cada cuenta sus propias plantas.
          </p>
          <p>
            Las personas que administran el catálogo de especies tienen dos
            excepciones:
          </p>
          <ul>
            <li>
              Pueden ver cuántas plantas de todos los usuarios están enlazadas a
              cada especie: solo el número, sin saber de quién son.
            </li>
            <li>
              Ven las plantas cuyo nombre está «por validar», para confirmar a
              qué especie corresponden. Las ven agrupadas con las de otros
              usuarios que escribieron el mismo nombre con el mismo género. De
              cada grupo ven el nombre tal como lo escribió la mayoría, el
              género, el tipo más frecuente, cuántas plantas hay y hasta seis
              fotos. Pueden abrir todas las fotos de esas plantas mientras el
              nombre está «por validar», no las de las demás. No reciben el
              origen, la ubicación, el apodo, las fechas, las notas de la planta
              ni las de las fotos, y la pantalla no les muestra de quién son.
              Tampoco ven la bitácora de esas plantas, ni sus registros ni sus
              fotos.
            </li>
          </ul>
          <p>
            Los cambios que hacen en el catálogo quedan registrados. Cuando
            resuelven un nombre «por validar», el registro guarda ese nombre, el
            género y cuántas plantas había, pero no de quién eran ni sus fotos.
          </p>
          <p>
            Ninguna cuenta de la app puede leer los eventos de uso, tampoco los
            tuyos: solo se consultan en la base de datos para calcular las
            mediciones.
          </p>
        </>
      ),
    },
    {
      id: 'privacidad-dispositivo',
      title: 'Qué se guarda en tu dispositivo',
      summary:
        'Una copia de tu inventario y lo que la app necesita para funcionar sin conexión; casi todo se borra al cerrar sesión.',
      children: (
        <>
          <ul>
            <li>
              Una copia de tu inventario, para que puedas verlo y buscar en él
              sin conexión. Se borra al cerrar sesión.
            </li>
            <li>
              Las miniaturas de tus fotos, para que la colección cargue rápido y
              se vea sin conexión. Se borran al cerrar sesión.
            </li>
            <li>
              Los eventos de uso que aún no se enviaron, por ejemplo porque no
              había conexión. Se borran al enviarse, a los 29 días o al cerrar
              sesión.
            </li>
            <li>
              Tu identificador de usuario (no tu correo ni tu nombre), para
              mostrarte tu copia sin conexión. Se borra al cerrar sesión. Si
              cierras sesión sin conexión, se guarda hasta que la app pueda
              avisar al servicio de acceso.
            </li>
            <li>
              Los borradores de las plantas que estás registrando (hasta dos),
              con sus fotos si las elegiste, para no perderlos si se recarga la
              página o te quedas sin conexión. Cada uno se borra al registrarla
              o al descartarlo, y caduca a las 24 horas de su último cambio.
            </li>
            <li>Cómo prefieres ver el inventario (lista o cuadrícula).</li>
            <li>
              La bitácora no se guarda en tu dispositivo: para verla, añadir o
              eliminar registros hace falta conexión. Mientras la ves, sus fotos
              solo están en la memoria de la pestaña abierta.
            </li>
            <li>
              Los archivos de la propia app, para que abra sin conexión, y lo
              que el servicio de acceso necesita para mantener tu sesión.
            </li>
          </ul>
          <p>
            Cerrar sesión borra la copia, las miniaturas, los eventos pendientes
            y tu identificador, también sin conexión. Mientras no la cierres,
            quien tenga tu dispositivo desbloqueado puede ver la copia de tu
            inventario.
          </p>
        </>
      ),
    },
    {
      id: 'privacidad-eliminar',
      title: 'Cómo eliminar tu cuenta',
      summary: (
        <>
          Desde <Link to={PATHS.account}>Tu cuenta</Link>, con conexión. No se
          puede deshacer; antes puedes descargar tu inventario.
        </>
      ),
      children: (
        <>
          <p>
            Desde la app, con la sesión iniciada:{' '}
            <Link to={PATHS.account}>Tu cuenta, Eliminar mi cuenta</Link>.
            Necesitas conexión. Se borran tus plantas con sus notas y su
            bitácora, sus fotos (también las de la bitácora), tu perfil, tus
            eventos de uso y tu cuenta de acceso. También lo que orqui.app
            guarda en ese dispositivo: la copia de tu inventario, las
            miniaturas, los eventos pendientes de enviar, tu identificador, los
            borradores y tus preferencias. No se puede deshacer.
          </p>
          <p>
            No se borran los informes de errores que ya se enviaron a Sentry
            (llevan tu identificador, no tu correo). Tampoco el registro de
            cambios del catálogo: si ya se resolvió un nombre que escribiste,
            ese nombre sigue ahí, sin decir de quién era.
          </p>
          <h3 className="orki-textpage__subheading">
            Borrar un registro o una planta
          </h3>
          <p>
            Puedes eliminar un registro de la bitácora desde la ficha de su
            planta: se borra con su foto. Al eliminar una planta se borran
            también sus notas, toda su bitácora y todas sus fotos. Las dos cosas
            necesitan conexión y no se pueden deshacer.
          </p>
          <h3 className="orki-textpage__subheading">Descargar tu inventario</h3>
          <p>
            Antes, o cuando quieras, puedes descargar tu inventario en un
            archivo CSV con «Exportar a CSV», al final de{' '}
            <Link to={PATHS.collection}>Mi colección</Link>. Incluye todas tus
            plantas, también las perdidas y regaladas, con todos sus datos, sus
            notas y la fecha en que las registraste. No incluye las fotos ni la
            bitácora.
          </p>
        </>
      ),
    },
  ]
}

function Contact() {
  const contactPending = isPrivacyContactPending()
  return (
    <section
      aria-labelledby="privacidad-contacto"
      className="orki-textpage__section"
    >
      <h2 id="privacidad-contacto" className="orki-textpage__heading">
        Contacto
      </h2>
      {contactPending ? (
        <p>
          Todavía no hay un medio de contacto publicado para consultas de
          privacidad.
        </p>
      ) : (
        <p>
          Para cualquier consulta sobre tus datos, escribe a{' '}
          <a href={privacyContactHref()}>{PRIVACY_CONTACT}</a>.
        </p>
      )}
    </section>
  )
}

export default function PrivacyPage() {
  const state: unknown = useLocation().state
  return (
    <TextPage
      title="Privacidad"
      lead="Qué datos guarda orqui.app, dónde, quién puede verlos y cómo borrarlos."
      updated={{ label: PRIVACY_LAST_UPDATED, iso: PRIVACY_LAST_UPDATED_ISO }}
      sections={sections(state)}
    >
      <Contact />
    </TextPage>
  )
}
