// Filas montadas en Inicio, Series y Películas (como el RowList de Roku, que ya tiene listas las filas de abajo).
// Al bajar, la lista armaba la fila nueva justo al apretar la flecha (sus carátulas y su lista horizontal) y la app se
// trababa a cada paso; al subir no, porque las de arriba ya estaban. Ahora: las 2 filas junto a la enfocada se montan
// siempre; el resto de la ventana (5 abajo, 3 arriba) se monta de a una en los momentos quietos, y lo que queda más allá
// de una fila de margen se suelta también quieto. Las filas fuera de la ventana son solo su título y su alto.
export type Win = { lo: number; hi: number };

export const NEAR = 2;
export const AHEAD = 5;
export const BEHIND = 3;
// tope de filas montadas recorriendo seguido (sin momentos quietos): se suelta lo más lejano
export const MAX_ROWS = 12;

// foco en la fila r de n: solo agrega las cercanas que falten (nada se suelta al apretar)
export function onFocusWin(w: Win, r: number, n: number): Win {
  let lo = Math.max(0, Math.min(w.lo, r - NEAR));
  let hi = Math.min(n - 1, Math.max(w.hi, r + NEAR));
  if (hi - lo + 1 > MAX_ROWS) {
    if (r - lo > hi - r) lo = hi - MAX_ROWS + 1;
    else hi = lo + MAX_ROWS - 1;
  }
  return lo === w.lo && hi === w.hi ? w : { lo, hi };
}

// un paso en un momento quieto: una fila más abajo, después una más arriba y al final se sueltan las lejanas.
// null = ya está todo
export function idleStep(w: Win, r: number, n: number): Win | null {
  if (w.hi < Math.min(n - 1, r + AHEAD)) return { lo: w.lo, hi: w.hi + 1 };
  if (w.lo > Math.max(0, r - BEHIND)) return { lo: w.lo - 1, hi: w.hi };
  const lo = Math.max(w.lo, r - BEHIND - 1);
  const hi = Math.min(w.hi, r + AHEAD + 1);
  return lo !== w.lo || hi !== w.hi ? { lo, hi } : null;
}
