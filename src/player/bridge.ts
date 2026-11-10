// Puente con caché de la VPS / VDS para películas y capítulos (2.0.18; media_worker.php?do=vod del panel).
//
// Los servidores IPTV tardan 3-6 s en empezar a contestar cada pedido y los lectores de MP4 y MKV piden el archivo por
// partes: con 6 pedidos eran ~21 s solo de espera (avisos «tardó en empezar» con espera_media=3487ms) y en líneas de
// una conexión cada pedido peleaba la conexión con el anterior. Con el puente, la VPS del dueño o la VDS del
// distribuidor baja el archivo con UNA conexión continua (como ExoPlayer), lo guarda por delante de lo que se ve y
// contesta cada pedido de la app desde su disco. Los lectores no cambian: rangeget.ts pide al puente en lugar del
// servidor IPTV (la dirección del archivo sigue siendo la misma para todo lo demás: índice guardado, idiomas, avance).
// Sin máquina para la línea (o el puente apagado o caído) todo sigue directo, como antes.
const keyOf = (url: string) => url.replace(/^https?:\/\//i, '');
const links = new Map<string, string>();
// el panel dijo que esta línea no tiene máquina: se pide directo sin esperar
const none = new Set<string>();
// el puente falló con este archivo: directo el resto de la sesión
const broken = new Set<string>();

// la respuesta del panel para este archivo (enlace firmado del puente, o '' = sin máquina)
export function setBridge(url: string, link: string): void {
  const k = keyOf(url);
  if (link) {
    links.set(k, link);
    none.delete(k);
    if (links.size > 50) links.delete(links.keys().next().value as string);
  } else none.add(k);
}

// dirección a la que se piden los tramos de este archivo: el puente, o '' (directo)
export function viaBridge(url: string): string {
  const k = keyOf(url);
  return broken.has(k) ? '' : links.get(k) || '';
}

// el panel ya contestó que no hay puente (Player puede pedir el principio por adelantado sin chocar con la máquina)
export function bridgeNone(url: string): boolean {
  const k = keyOf(url);
  return none.has(k) || broken.has(k);
}

// el puente no entregó (apagado, máquina caída, servidor IPTV que no contesta a la máquina): directo
export function bridgeFailed(url: string): void {
  broken.add(keyOf(url));
}
