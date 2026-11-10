// Identificador del equipo (el «MAC» que queda registrado en el panel): 8 pares hex en mayúsculas que nunca empiezan
// en "00". Vega OS no da a las apps ningún número propio del equipo (ni serie ni MAC), así que se crea una vez y se
// guarda en el equipo: es el mismo en cada inicio y en cada actualización; solo cambia si se desinstala la app.
import { read, storageLoaded, write } from './storage';

// creado sin poder leer lo guardado: vale solo hasta cerrar la app
let temp = '';

export function deviceId(): string {
  const saved = read('device_id');
  if (saved) return saved;
  if (temp) return temp;
  let hex = '';
  for (let i = 0; i < 16; i++) hex += '0123456789ABCDEF'[Math.floor(Math.random() * 16)];
  if (hex.startsWith('00')) hex = '1' + hex.slice(1);
  const id = hex.match(/.{2}/g)!.join(':');
  // sin haber leído lo guardado (todavía cargando, o la lectura falló) no se escribe encima: el identificador que el
  // panel ya tiene registrado sigue en el equipo y vuelve en el próximo inicio
  if (storageLoaded()) write('device_id', id);
  else temp = id;
  return id;
}
