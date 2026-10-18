// Guardado en el equipo. Se carga todo al iniciar para poder leerlo sin esperar.
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'latmpx:';
const mem: Record<string, string> = {};

export async function loadStorage(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(PREFIX));
    const pairs = await AsyncStorage.multiGet(keys);
    for (const [k, v] of pairs) if (v !== null) mem[k.slice(PREFIX.length)] = v;
  } catch {
    // sin almacenamiento la app sigue funcionando en memoria
  }
}

export function read(key: string, def = ''): string {
  return key in mem ? mem[key] : def;
}

export function write(key: string, value: string): void {
  mem[key] = value;
  AsyncStorage.setItem(PREFIX + key, value).catch(() => {});
}

// claves guardadas (sin el prefijo)
export function keys(): string[] {
  return Object.keys(mem);
}

export function remove(key: string): void {
  delete mem[key];
  AsyncStorage.removeItem(PREFIX + key).catch(() => {});
}

export function readJson<T>(key: string): T | null {
  const raw = read(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  write(key, JSON.stringify(value));
}

export function pref(key: string, def: string): string {
  return read('pref_' + key, def);
}

export function setPref(key: string, value: string): void {
  write('pref_' + key, value);
}
