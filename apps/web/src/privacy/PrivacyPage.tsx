import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { CATALOGUE_OF_LIFE_ATTRIBUTION } from '../backoffice/attribution.ts'
import { Page } from '../components/Page.tsx'
import { PATHS } from '../routes/paths.ts'
import {
  isPrivacyContactPending,
  PRIVACY_CONTACT,
  privacyContactHref,
} from './contact.ts'

// Página pública de privacidad (/privacidad, #111, parte de #26).
//
// BORRADOR PENDIENTE DE REVISIÓN POR UNA PERSONA. Lo redactó un agente a
// partir del código de esta rama (21 de noviembre de 2026, actualizado tras el
// modo sin conexión, los eventos de uso, Sentry, la cola de propuestas y la
// exportación a CSV); no es asesoría legal. Antes de darlo por bueno, alguien
// con criterio legal debe revisarlo (ley peruana de protección de datos
// personales, #26) y comprobar las afirmaciones que lista el README ("Página
// de privacidad"). Al cambiar lo que guarda o envía la app (eventos, Sentry,
// lo que se guarda en el dispositivo...), este texto cambia con ella.
//
// Va en su propio chunk (carga diferida desde App.tsx). De la atribución solo
// importa backoffice/attribution.ts, un módulo sin React que lee
// scripts/catalog-import/fuente.json al compilar; no arrastra la pantalla del
// backoffice.

/** Fecha de la última actualización del texto, en el formato que se muestra. */
const PRIVACY_LAST_UPDATED = '21 de noviembre de 2026'
const PRIVACY_LAST_UPDATED_ISO = '2026-11-21'

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-space-2">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
}

const LINK = 'font-semibold text-secondary underline'

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className={LINK} href={href} rel="noopener noreferrer" target="_blank">
      {children} <span className="sr-only">(se abre en otra pestaña)</span>
    </a>
  )
}

export default function PrivacyPage() {
  const { version, doiUrl, license, licenseUrl } = CATALOGUE_OF_LIFE_ATTRIBUTION
  const contactPending = isPrivacyContactPending()

  return (
    <Page title="Privacidad">
      <div className="flex flex-col gap-space-4 text-md">
        <p>
          Qué datos guarda Orki, dónde, quién puede verlos y cómo borrarlos.
          Última actualización:{' '}
          <time dateTime={PRIVACY_LAST_UPDATED_ISO}>
            {PRIVACY_LAST_UPDATED}
          </time>
          .
        </p>

        <Section id="privacidad-datos" title="Qué datos guarda Orki">
          <ul className="list-disc space-y-space-1 pl-space-4">
            <li>
              <strong>Tu cuenta:</strong> tu correo y, si entras con Google, los
              datos de tu perfil de Google que recibe el servicio de acceso
              (como tu nombre y tu foto). Orki guarda además un perfil con tu
              identificador de usuario y el idioma de la app.
            </li>
            <li>
              <strong>Tus plantas:</strong> lo que registras de cada una: el
              nombre, el género, el tipo, la fecha de adquisición, el origen y,
              si los añades, la ubicación, el apodo, el color de la flor y su
              estado (activa, perdida o regalada).
            </li>
            <li>
              <strong>Las fotos de tus plantas:</strong> antes de subirlas, la
              app las reduce en tu dispositivo y les quita los metadatos que
              guarda la cámara, incluida la ubicación. Se guardan la foto y una
              miniatura.
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
        </Section>

        <Section id="privacidad-mediciones" title="Mediciones de uso y errores">
          <p>La app registra dos tipos de evento de uso:</p>
          <ul className="list-disc space-y-space-1 pl-space-4">
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
            Orki no muestra publicidad ni usa otros servicios de analítica o de
            publicidad.
          </p>
        </Section>

        <Section
          id="privacidad-proveedores"
          title="Dónde se guardan y quién los procesa"
        >
          <ul className="list-disc space-y-space-1 pl-space-4">
            <li>
              <strong>Clerk</strong> gestiona el acceso: tu cuenta, tu correo,
              el acceso con Google y tu sesión.
            </li>
            <li>
              <strong>Supabase</strong> guarda tu perfil, tus plantas, sus fotos
              y tus eventos de uso. Las fotos están en un almacenamiento
              privado: no tienen una dirección pública.
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
            contiene datos personales.
          </p>
        </Section>

        <Section id="privacidad-acceso" title="Quién puede ver tus datos">
          <p>
            Tus plantas y sus fotos solo las ves tú. La base de datos solo
            entrega a cada cuenta sus propias plantas.
          </p>
          <p>
            Las personas que administran el catálogo de especies tienen dos
            excepciones:
          </p>
          <ul className="list-disc space-y-space-1 pl-space-4">
            <li>
              Pueden ver cuántas plantas de todos los usuarios están enlazadas a
              cada especie: solo el número, sin saber de quién son.
            </li>
            <li>
              Ven las plantas cuyo nombre está «por validar», para confirmar a
              qué especie corresponden. Las ven agrupadas con las de otros
              usuarios que escribieron el mismo nombre con el mismo género. De
              cada grupo ven el nombre tal como lo escribió la mayoría, el
              género, el tipo más frecuente, cuántas plantas hay y hasta cuatro
              fotos. Pueden abrir la foto actual de esas plantas, no la de las
              demás. No reciben el origen, la ubicación, el apodo ni las fechas,
              y la pantalla no les muestra de quién son.
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
        </Section>

        <Section
          id="privacidad-dispositivo"
          title="Qué se guarda en tu dispositivo"
        >
          <ul className="list-disc space-y-space-1 pl-space-4">
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
              El borrador de la planta que estás registrando, con su foto si la
              elegiste, para no perderlo si se recarga la página. Se borra al
              guardarla o al descartarla, y caduca a las 24 horas.
            </li>
            <li>Cómo prefieres ver el inventario (lista o cuadrícula).</li>
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
        </Section>

        <Section
          id="privacidad-eliminar"
          title="Cómo eliminar tu cuenta y tus datos"
        >
          <p>
            Desde la app, con la sesión iniciada:{' '}
            <Link className={LINK} to={PATHS.account}>
              Tu cuenta, Eliminar mi cuenta
            </Link>
            . Necesitas conexión. Se borran tus plantas, sus fotos, tu perfil,
            tus eventos de uso y tu cuenta de acceso. También lo que Orki guarda
            en ese dispositivo: la copia de tu inventario, las miniaturas, los
            eventos pendientes de enviar, tu identificador, el borrador y tus
            preferencias. No se puede deshacer.
          </p>
          <p>
            No se borran los informes de errores que ya se enviaron a Sentry
            (llevan tu identificador, no tu correo). Tampoco el registro de
            cambios del catálogo: si ya se resolvió un nombre que escribiste,
            ese nombre sigue ahí, sin decir de quién era.
          </p>
          <p>
            Antes, o cuando quieras, puedes descargar tu inventario en un
            archivo CSV con «Exportar a CSV», al final de{' '}
            <Link className={LINK} to={PATHS.collection}>
              Mi colección
            </Link>
            . Incluye todas tus plantas, también las perdidas y regaladas, con
            todos sus datos y la fecha en que las registraste. No incluye las
            fotos.
          </p>
        </Section>

        <Section id="privacidad-catalogo" title="Fuente del catálogo">
          <p>
            El catálogo de especies se basa en el{' '}
            <span lang="en">Catalogue of Life</span> ({version}),{' '}
            <External href={doiUrl}>{doiUrl}</External>, con licencia{' '}
            <External href={licenseUrl}>{license}</External>. Orki lo filtró a
            las orquídeas y lo normalizó.
          </p>
        </Section>

        <Section id="privacidad-contacto" title="Contacto">
          {contactPending ? (
            <p>
              Todavía no hay un medio de contacto publicado para consultas de
              privacidad.
            </p>
          ) : (
            <p>
              Para cualquier consulta sobre tus datos, escribe a{' '}
              <a className={LINK} href={privacyContactHref()}>
                {PRIVACY_CONTACT}
              </a>
              .
            </p>
          )}
        </Section>
      </div>
    </Page>
  )
}
