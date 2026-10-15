// Control remoto de LG (Magic Remote o el básico): las teclas llegan como keydown. Se pasan a los
// useTVEventHandler (como en Vega), las flechas mueven el foco (spatial.ts) y Atrás (461) va al BackHandler.
// webOS entrega todas las teclas sin registrarlas (appinfo.json: disableBackHistoryAPI para recibir Atrás).
import { pressBack } from './back';
import { keepFocus, move } from './spatial';

type Listener = (e: { eventType: string; eventKeyAction: number }) => void;
const listeners: Listener[] = [];

export function onRemote(l: Listener): () => void {
  listeners.push(l);
  return () => {
    const i = listeners.indexOf(l);
    if (i >= 0) listeners.splice(i, 1);
  };
}

// keyCode → evento de Vega (useTVEventHandler)
const EVENTS: Record<number, string> = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'select',
  415: 'play', 19: 'pause', 413: 'pause', 412: 'rewind', 417: 'fastforward',
  33: 'channel_up', 34: 'channel_down', 457: 'info',
  // colores: rojo y verde abren el menú de audio y subtítulos (como TOOLS en Samsung)
  403: 'menu', 404: 'menu',
};
const BACK = new Set([461, 27]);
const ARROWS: Record<number, 'left' | 'up' | 'right' | 'down'> = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };

function inText(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

export function installRemote(): void {
  keepFocus();

  // en captura: las casillas de texto no se quedan con las flechas
  document.addEventListener('keydown', e => {
    const el = document.activeElement;
    const typing = inText(el);
    // Atrás (en una casilla de texto, Borrar sigue borrando)
    if (BACK.has(e.keyCode) || (e.keyCode === 8 && !typing)) {
      e.preventDefault();
      pressBack();
      return;
    }
    const type = EVENTS[e.keyCode];
    if (type) for (const l of listeners.slice()) l({ eventType: type, eventKeyAction: 0 });
    const dir = ARROWS[e.keyCode];
    if (!dir) return;
    // en una casilla de texto ◀▶ mueven el cursor; se sale por el borde
    if (typing && (dir === 'left' || dir === 'right')) {
      const t = el as HTMLInputElement;
      const end = dir === 'left' ? t.selectionStart === 0 : t.selectionEnd === t.value.length;
      if (!end) return;
    }
    e.preventDefault();
    move(dir);
  }, true);
}
