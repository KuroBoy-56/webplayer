// Navegación con las flechas entre lo que tiene foco (como el foco de React Native TV): se elige el más
// cercano en esa dirección, prefiriendo los que están en la misma fila o columna.
const FOCUSABLE = '[tabindex]:not([tabindex="-1"]), input, textarea, select, button, a[href]';

type Dir = 'left' | 'up' | 'right' | 'down';

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
}

// con un Modal abierto (aria-modal) solo cuenta lo de adentro: lo de atrás no se ve pero está más cerca
function candidates(): HTMLElement[] {
  const modals = document.querySelectorAll<HTMLElement>('[aria-modal="true"]');
  const scope: ParentNode = modals.length ? modals[modals.length - 1] : document;
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);
}

// lo último que tuvo el foco: al volver a una pantalla (cerrar el reproductor, Atrás) se vuelve ahí
const history: HTMLElement[] = [];

function remembered(): HTMLElement | null {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].isConnected && visible(history[i])) return history[i];
  return null;
}

// como en la TV de Vega siempre hay algo con foco: si se perdió (cambió la pantalla) vuelve solo
export function keepFocus(): void {
  document.addEventListener('focusin', e => {
    const el = e.target as HTMLElement;
    const i = history.indexOf(el);
    if (i >= 0) history.splice(i, 1);
    history.push(el);
    if (history.length > 30) history.shift();
  });
  setInterval(() => {
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && a.isConnected && visible(a)) return;
    (remembered() || first())?.focus();
  }, 250);
}

// primer elemento con foco de la pantalla (arriba a la izquierda)
function first(): HTMLElement | null {
  const all = candidates();
  all.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return ra.top - rb.top || ra.left - rb.left;
  });
  return all[0] || null;
}

export function score(dir: Dir, from: DOMRect, to: DOMRect): number {
  const horiz = dir === 'left' || dir === 'right';
  // distancia en la dirección pedida (borde con borde) y desvío en la otra
  let main: number;
  if (dir === 'right') main = to.left - from.right;
  else if (dir === 'left') main = from.left - to.right;
  else if (dir === 'down') main = to.top - from.bottom;
  else main = from.top - to.bottom;
  const fromC = horiz ? from.top + from.height / 2 : from.left + from.width / 2;
  const toC = horiz ? to.top + to.height / 2 : to.left + to.width / 2;
  // si se superponen en el otro eje no hay desvío (misma fila o columna)
  const overlap = horiz ? to.bottom > from.top && to.top < from.bottom : to.right > from.left && to.left < from.right;
  const side = overlap ? 0 : Math.abs(toC - fromC);
  // centro detrás del elemento actual: no está en esa dirección
  const fromMain = horiz ? from.left + from.width / 2 : from.top + from.height / 2;
  const toMain = horiz ? to.left + to.width / 2 : to.top + to.height / 2;
  const ahead = dir === 'right' || dir === 'down' ? toMain > fromMain : toMain < fromMain;
  if (!ahead || main < -Math.min(horiz ? from.width : from.height, 40)) return Infinity;
  // fuera de la fila / columna solo vale lo que está dentro de un cono de 45° (no saltos en diagonal)
  if (!overlap && side > Math.max(main, 0) + (horiz ? from.height : from.width) / 2) return Infinity;
  return Math.max(0, main) + side * 2.5;
}

export function move(dir: Dir): void {
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || cur === document.body || !visible(cur)) {
    (remembered() || first())?.focus();
    return;
  }
  const from = cur.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of candidates()) {
    if (el === cur || el.contains(cur) || cur.contains(el)) continue;
    const s = score(dir, from, el.getBoundingClientRect());
    if (s < bestScore) {
      bestScore = s;
      best = el;
    }
  }
  best?.focus();
}

// hasTVPreferredFocus: el foco empieza ahí cuando el elemento aparece
export function preferFocus(el: HTMLElement): void {
  setTimeout(() => {
    if (el.isConnected && visible(el)) el.focus();
  }, 50);
}
