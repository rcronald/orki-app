import { LAST_USER_KEY } from '../auth/offline-identity.ts'
import {
  ATRIBUTO_PORTADA_PREVIA,
  PLANTILLA_PORTADA_PREVIA_ID,
  PORTADA_PREVIA_ID,
} from './portada-previa.ts'

// Scripts en línea de la portada prerrenderada (#204; ver portada-previa.ts).
// Solo los usa el plugin del build: aparte para que la app no los arrastre.

/**
 * Script del <head>: decide si se muestra la portada prerrenderada y, si es
 * así, precarga la foto. Sin almacenamiento (algunos modos privados) se trata
 * como sin usuario recordado, igual que offline-identity.ts.
 */
export function scriptDeCabecera(foto: {
  srcset: string
  sizes: string
}): string {
  return `(function(){var d=document.documentElement;if(location.pathname!=='/')return;var u=null;try{u=localStorage.getItem(${JSON.stringify(LAST_USER_KEY)})}catch(e){}if(u)return;try{var s=history.state&&history.state.usr;if(s&&s.accountDeleted===true)return}catch(e){}d.setAttribute(${JSON.stringify(ATRIBUTO_PORTADA_PREVIA)},'');var l=document.createElement('link');l.setAttribute('rel','preload');l.setAttribute('as','image');l.setAttribute('type','image/avif');l.setAttribute('imagesrcset',${JSON.stringify(foto.srcset)});l.setAttribute('imagesizes',${JSON.stringify(foto.sizes)});l.setAttribute('fetchpriority','high');document.head.appendChild(l)})()`
}

/**
 * Atributos con los que la plantilla guarda las direcciones de la foto. El
 * HTML prerrenderado no lleva ningún `src` ni `srcset` de archivo: Firefox
 * descarga por adelantado las imágenes de un <template> (su lector previo del
 * HTML no respeta que la plantilla sea inerte), así que con las direcciones
 * reales pediría la foto en cualquier ruta.
 */
export const ATRIBUTO_SRC_DIFERIDO = 'data-orki-src'
export const ATRIBUTO_SRCSET_DIFERIDO = 'data-orki-srcset'

/**
 * Cambia `src` y `srcset` con dirección de archivo por sus atributos
 * diferidos. Las data URL (el logotipo) se quedan: no se descargan.
 */
export function diferirImagenes(html: string): string {
  return html
    .replace(/ srcset="(?!data:)/gi, ` ${ATRIBUTO_SRCSET_DIFERIDO}="`)
    .replace(/ src="(?!data:)/gi, ` ${ATRIBUTO_SRC_DIFERIDO}="`)
}

/**
 * Script tras #root: si toca mostrarla, copia la plantilla a un contenedor
 * antes de #root y, ya en el documento y en orden (primero los <source>,
 * después el <img>), devuelve a la foto sus direcciones reales.
 */
export const SCRIPT_DE_CUERPO = `(function(){var t=document.getElementById(${JSON.stringify(PLANTILLA_PORTADA_PREVIA_ID)});if(!t)return;if(document.documentElement.hasAttribute(${JSON.stringify(ATRIBUTO_PORTADA_PREVIA)})){var c=document.createElement('div');c.id=${JSON.stringify(PORTADA_PREVIA_ID)};c.appendChild(t.content.cloneNode(true));var r=document.getElementById('root');r.parentNode.insertBefore(c,r);var a=[[${JSON.stringify(ATRIBUTO_SRCSET_DIFERIDO)},'srcset'],[${JSON.stringify(ATRIBUTO_SRC_DIFERIDO)},'src']];for(var i=0;i<a.length;i++){var n=c.querySelectorAll('['+a[i][0]+']');for(var j=0;j<n.length;j++){n[j].setAttribute(a[i][1],n[j].getAttribute(a[i][0]));n[j].removeAttribute(a[i][0])}}}t.remove()})()`
