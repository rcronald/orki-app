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
// partir del código de esta rama (21 de noviembre de 2026); no es asesoría
// legal. Antes de darlo por bueno, alguien con criterio legal debe revisarlo
// (ley peruana de protección de datos personales, #26) y comprobar las
// afirmaciones que lista el README ("Página de privacidad"). Al cambiar lo que
// guarda la app (analítica, exportación, cola de propuestas...), este texto
// cambia con ella.
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
          </ul>
          <p>
            Los usamos solo para que la app funcione: que entres en tu cuenta y
            veas y gestiones tu colección.
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
              <strong>Supabase</strong> guarda tu perfil, tus plantas y sus
              fotos. Las fotos están en un almacenamiento privado: no tienen una
              dirección pública.
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
              Pueden abrir la foto actual de las plantas cuyo nombre está «por
              validar» (no la de las demás), para confirmar a qué especie
              corresponden. La app aún no tiene la pantalla para hacerlo; cuando
              la tenga, también verán el nombre que escribiste para esas
              plantas.
            </li>
          </ul>
        </Section>

        <Section
          id="privacidad-dispositivo"
          title="Qué se guarda en tu dispositivo"
        >
          <ul className="list-disc space-y-space-1 pl-space-4">
            <li>
              El borrador de la planta que estás registrando, para no perderlo
              si se recarga la página. Se borra al guardarla o al descartarla, y
              caduca a las 24 horas.
            </li>
            <li>
              Las miniaturas de tus fotos, para que la colección cargue rápido.
              Se borran al cerrar sesión.
            </li>
            <li>Cómo prefieres ver el inventario (lista o cuadrícula).</li>
            <li>
              Los archivos de la propia app, para que abra sin conexión, y lo
              que el servicio de acceso necesita para mantener tu sesión.
            </li>
          </ul>
          <p>Orki no usa analítica ni publicidad.</p>
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
            . Se borran tus plantas, sus fotos, tu perfil, tu cuenta de acceso y
            lo que Orki guarda en ese dispositivo. No se puede deshacer.
          </p>
          <p>Por ahora la app no tiene una opción para descargar tus datos.</p>
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
