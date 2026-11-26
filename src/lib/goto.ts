// Cambiar de sección del menú de arriba desde una pantalla (la tarjeta «Ir a Deportes» de Inicio). Main la registra.
let fn: ((section: string) => void) | null = null;
export const setGoto = (f: ((section: string) => void) | null) => {
  fn = f;
};
export const goto = (section: string) => fn?.(section);
