// Borrado de caché remoto: el panel manda en check_mac "cache_clear" = id de la orden más nueva para
// esta app y la app le dice con "cc" la última que ya aplicó. El id aplicado se guarda aparte
// (cache_clear_seen, por distribuidor) y el borrado nunca lo toca.
import { keys, read, remove, write } from './storage';
import { scoped } from './tenant';

const SEEN = 'cache_clear_seen';

export function cacheSeen(): number {
  return Number(read(scoped(SEEN))) || 0;
}

// saved '' = nada guardado (primera vez o app recién actualizada): se guarda en silencio
export function cacheDecision(saved: string, got: number): 'save' | 'clear' | 'none' {
  if (saved === '') return 'save';
  return got > (Number(saved) || 0) ? 'clear' : 'none';
}

// "cache_clear" de la respuesta; true = hay que borrar y reiniciar (el id nuevo ya quedó guardado
// antes, para no repetirlo en bucle). Sin el campo (panel viejo) no se hace nada.
export function takeCacheOrder(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  const got = Math.floor(Number(value));
  if (!Number.isFinite(got) || got < 0) return false;
  const d = cacheDecision(read(scoped(SEEN)), got);
  if (d !== 'none') write(scoped(SEEN), String(got));
  return d === 'clear';
}

// lo guardado que se vuelve a descargar (servidores del panel y clave TMDB, de todos los
// distribuidores) y la caché HTTP del navegador si la hay. Se quedan la sesión, el distribuidor,
// los ajustes, el PIN y cache_clear_seen.
export function clearStoredCache(): void {
  for (const k of keys()) if (/^(servers|tmdb_key)(@|$)/.test(k)) remove(k);
  try {
    const c = (globalThis as any).caches;
    c?.keys?.().then((ks: string[]) => ks.forEach(k => c.delete(k))).catch(() => {});
  } catch {
    // sin Cache Storage
  }
}
