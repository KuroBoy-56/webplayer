// Identificador del equipo (el «MAC» que queda registrado en el panel). 1.2.6
//
// Sale del identificador que el fabricante le da al televisor: DUID de Samsung (webapis.productinfo.getDuid, el «Unique ID» de Soporte › Acerca del televisor). No lo guarda la app: es el mismo aunque se
// desinstale y se vuelva a instalar (platform.ts lo pasa a formato MAC). Reglas:
// - El que ya está guardado se respeta siempre: el panel lo tiene registrado con la línea del cliente.
// - Instalación nueva: el del televisor. Si el televisor no lo da en esa apertura, uno al azar marcado como tal; en
//   cuanto el televisor lo da (y todavía no se inició sesión con el otro), se cambia por el fijo. Antes ese número al
//   azar quedaba para siempre y cambiaba al reinstalar: el cliente creía que le habían borrado la cuenta.
// - Con el panel (api/login.php «device_id», includes/device_alias.php): el identificador del televisor es la «clave
//   fija» del equipo. La app ya instalada la deja anotada junto al número que usa (también si es uno al azar de una
//   versión anterior) y una instalación nueva pregunta con esa clave y recibe el número con el que el televisor ya
//   estaba registrado. Un panel sin esa función no cambia nada.
import { read, write } from './storage';
import { tvAltKey, tvMac } from './platform';

// de dónde salió el guardado: 'h' = del televisor (fijo), 'r' = al azar, 'p' = el de antes (devuelto por el panel);
// sin marca = guardado por una versión anterior
const SRC = 'device_id_src';
// '1': el identificador lo puso esta instalación y todavía no se inició sesión con él (solo entonces se cambia por otro)
const NEW = 'device_new';
// con qué (clave, distribuidor, identificador) ya se consultó al panel
const SYNC = 'device_sync';
const MAC = /^[0-9A-F]{2}(:[0-9A-F]{2}){5,7}$/;
// identificador que se cambió por el que devolvió el panel en esta apertura (lo que ya lo tenía en la mano lo cambia)
let replaced: { from: string; to: string } | null = null;

let tv = '';
function tvId(): string {
  if (!tv) tv = tvMac();
  return tv;
}

export function deviceId(): string {
  const saved = read('device_id');
  const fixed = tvId();
  if (saved && !(fixed && saved !== fixed && read(SRC) === 'r' && read(NEW) === '1')) return saved;
  if (fixed) {
    write('device_id', fixed);
    write(SRC, 'h');
    write(NEW, '1');
    return fixed;
  }
  let hex = '';
  for (let i = 0; i < 16; i++) hex += '0123456789ABCDEF'[Math.floor(Math.random() * 16)];
  if (hex.startsWith('00')) hex = '1' + hex.slice(1);
  const id = hex.match(/.{2}/g)!.join(':');
  write('device_id', id);
  write(SRC, 'r');
  write(NEW, '1');
  return id;
}

// claves fijas del equipo para el panel (una letra de tipo + hex): el identificador del televisor (DUID) y, de respaldo,
// el Tizen ID del sistema
let alt: string | null = null;
export function hwKeys(): string[] {
  const fixed = tvId();
  if (alt === null) alt = tvAltKey();
  return [fixed ? 'd' + fixed.replace(/:/g, '') : '', alt ? 't' + alt : ''].filter(Boolean);
}

export function deviceFresh(): boolean {
  return read(NEW) === '1';
}

const mark = (tenant: string) => hwKeys().join(',') + '|' + tenant + '|' + read('device_id');

// ¿falta consultar al panel con estas claves, este distribuidor y este identificador?
export function syncNeeded(tenant: string): boolean {
  return hwKeys().length > 0 && !!read('device_id') && read(SYNC) !== mark(tenant);
}

// El panel contestó: got es el identificador a usar. Si es otro (el que este televisor tenía antes de reinstalar) y
// esta instalación todavía no registró el suyo, se adopta.
export function syncDone(tenant: string, sent: string, got: string): void {
  if (got !== sent && deviceFresh() && read('device_id') === sent && MAC.test(got)) {
    write('device_id', got);
    write(SRC, 'p');
    write(NEW, '');
    replaced = { from: sent, to: got };
  }
  write(SYNC, mark(tenant));
}

// el identificador vigente para un pedido que se armó con id (pudo cambiar por el del panel mientras tanto)
export function currentId(id: string): string {
  return replaced && id === replaced.from ? replaced.to : id;
}

// se inició sesión con el identificador actual: ya quedó registrado en el panel, no se cambia por otro
export function deviceRegistered(): void {
  if (read(NEW) === '1') write(NEW, '');
}
