// BackHandler de React Native con el botón Atrás del control de Hisense: el último que se registró
// contesta primero; si nadie lo usa, se sale de la app (como en Android TV).
type Handler = () => boolean | null | undefined;
const handlers: Handler[] = [];

export function exitApp(): void {
  // VIDAA: Hisense_Exit cierra la app y vuelve al inicio del televisor (ahí window.close no siempre hace nada); en un
  // navegador cierra la ventana
  try {
    const exit = (globalThis as any).Hisense_Exit;
    if (typeof exit === 'function') return void exit();
  } catch {
    // sin Hisense_Exit
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
