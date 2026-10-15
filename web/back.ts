// BackHandler de React Native con el botón Atrás del control de LG: el último que se registró
// contesta primero; si nadie lo usa, se sale de la app (como en Android TV).
type Handler = () => boolean | null | undefined;
const handlers: Handler[] = [];

export function exitApp(): void {
  // webOS: vuelve al lanzador de LG (como Atrás en las apps del televisor); en un navegador cierra la ventana
  try {
    const w = (globalThis as any).webOS;
    if (w?.platformBack) return w.platformBack();
  } catch {
    // sin webOS.js
  }
  window.close();
}

export const BackHandler = {
  addEventListener(_event: 'hardwareBackPress', h: Handler) {
    handlers.push(h);
    return {
      remove() {
        const i = handlers.lastIndexOf(h);
        if (i >= 0) handlers.splice(i, 1);
      },
    };
  },
  exitApp,
};

export function pressBack(): void {
  for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i]()) return;
  exitApp();
}
