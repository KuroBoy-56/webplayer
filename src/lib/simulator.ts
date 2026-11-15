// ¿La app corre en el Vega Virtual Device (el simulador de Amazon en la PC) y no en un Fire TV? (2.6.9)
//
// Señales que da el propio sistema (src/lib/deviceid.ts): la MAC por defecto de los emuladores (02:15:B2:00:00:00) o el
// identificador de Amazon que en el simulador no existe (NotSupportedError). En el simulador el reproductor de Amazon
// cerraba la app al entregarle una película o serie que el lector de la app no puede dar (un «.mp4» que no es MP4, audio
// Dolby: caja negra «0.0s abrir · 2.3s preparando… → cierre»), daba error 4 o cortaba el audio. Allí las películas y
// series no se le entregan nunca (Playback: nativeVodAllowed): lo que el lector no puede dar dice que no se puede
// reproducir, sin cerrar la app. En un Fire TV no cambia nada.
let sim = false;

export function setSimulator(on: boolean): void {
  sim = on;
}

export function onSimulator(): boolean {
  return sim;
}
