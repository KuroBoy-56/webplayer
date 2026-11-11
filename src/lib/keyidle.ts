// Última tecla del control remoto (2.1.1). Lo que trabaja en segundo plano y ocupa a la app (leer índices de
// Continuar viendo, idxwarm.ts) espera a que no se toque el control un momento: si no, la conversión de lo bajado
// coincidía con la navegación, las teclas se juntaban y la lista no se movía y después saltaba dos lugares.
let last = 0;

export function noteKey(): void {
  last = Date.now();
}

// milisegundos desde la última tecla
export function keyIdleMs(): number {
  return Date.now() - last;
}
