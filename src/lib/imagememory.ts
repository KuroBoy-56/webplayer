// Mientras la app está abierta: qué dirección cargó cada imagen (ChainImage) y cuáles dieron error. Al volver a una fila
// la carátula sale de una vez de la caché del equipo, sin esperar otra vez a la que no existe (un tiempo agotado no cuenta
// como error: la red pudo estar lenta).
const loadedFrom = new Map<string, string>();
const failed = new Set<string>();

const cap = (m: { size: number; clear: () => void }) => {
  if (m.size > 5000) m.clear();
};

// primera dirección que vale probar: la que ya cargó esta imagen o la primera que no dio error
export function firstSource(sources: string[]): number {
  const ok = loadedFrom.get(sources.join('\n'));
  const at = ok ? sources.indexOf(ok) : -1;
  if (at >= 0) return at;
  const i = sources.findIndex(u => !failed.has(u));
  return i < 0 ? sources.length - 1 : i;
}

export function sourceLoaded(sources: string[], uri: string): void {
  cap(loadedFrom);
  loadedFrom.set(sources.join('\n'), uri);
}

export function sourceFailed(uri: string): void {
  cap(failed);
  failed.add(uri);
}
