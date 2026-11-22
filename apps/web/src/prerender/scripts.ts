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

/** Script tras #root: copia la plantilla al contenedor si toca mostrarla. */
export const SCRIPT_DE_CUERPO = `(function(){var t=document.getElementById(${JSON.stringify(PLANTILLA_PORTADA_PREVIA_ID)});if(!t)return;if(document.documentElement.hasAttribute(${JSON.stringify(ATRIBUTO_PORTADA_PREVIA)})){var c=document.createElement('div');c.id=${JSON.stringify(PORTADA_PREVIA_ID)};c.appendChild(t.content.cloneNode(true));var r=document.getElementById('root');r.parentNode.insertBefore(c,r)}t.remove()})()`
